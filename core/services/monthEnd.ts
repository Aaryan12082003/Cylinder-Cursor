import { desc, eq } from 'drizzle-orm'
import { daysBetween, lastDayOfMonth, monthKey, monthsBetweenInclusive, nowIso, periodLabel, shiftMonth } from '@shared/dates'
import { formatCount } from '@shared/dates'
import type { MonthEndItem, MonthEndReport } from '@shared/types'
import type { AppContext, Db } from '../db/database'
import { inTx, one, rows, setting } from '../db/database'
import { customers, cylinderSizes, monthEndSnapshotItems, monthEndSnapshots, notifications } from '../db/schema'
import { BusinessError } from './errors'

export function listMonthEnds(ctx: AppContext) {
  return ctx.db
    .select()
    .from(monthEndSnapshots)
    .orderBy(desc(monthEndSnapshots.periodKey))
    .all()
    .map((row) => ({
      id: row.id,
      periodKey: row.periodKey,
      periodLabel: row.periodLabel,
      asOfDate: row.asOfDate,
      generatedAt: row.generatedAt,
      totalWithCustomers: row.totalWithCustomers,
      customerCount: row.customerCount,
    }))
}

export function getMonthEnd(ctx: AppContext, periodKey: string): MonthEndReport {
  const snapshot = ctx.db.select().from(monthEndSnapshots).where(eq(monthEndSnapshots.periodKey, periodKey)).get()
  if (!snapshot) throw new BusinessError('That month-end report has not been generated yet.')
  const items = ctx.db
    .select()
    .from(monthEndSnapshotItems)
    .where(eq(monthEndSnapshotItems.snapshotId, snapshot.id))
    .all()
  return mapSnapshot(snapshot, items)
}

function mapSnapshot(
  snapshot: typeof monthEndSnapshots.$inferSelect,
  items: (typeof monthEndSnapshotItems.$inferSelect)[],
): MonthEndReport {
  return {
    id: snapshot.id,
    periodKey: snapshot.periodKey,
    periodLabel: snapshot.periodLabel,
    asOfDate: snapshot.asOfDate,
    generatedAt: snapshot.generatedAt,
    totalWithCustomers: snapshot.totalWithCustomers,
    customerCount: snapshot.customerCount,
    items: items
      .map((item) => ({
        customerId: item.customerId,
        customerName: item.customerName,
        mobile: item.mobile ?? '',
        balances: JSON.parse(item.balancesJson) as Record<string, number>,
        totalOutstanding: item.totalOutstanding,
        lastDispatchDate: item.lastDispatchDate,
        lastReturnDate: item.lastReturnDate,
        daysSinceMovement: item.daysSinceMovement,
        overdue: Boolean(item.overdue),
      }))
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding || a.customerName.localeCompare(b.customerName)),
  }
}

function createSnapshot(ctx: AppContext, db: Db, period: string) {
  const asOf = lastDayOfMonth(period)
  const sizes = db.select().from(cylinderSizes).orderBy(cylinderSizes.sortOrder).all()
  const ledger = rows<{ customer_id: number; size_id: number; outstanding: number }>(
    ctx,
    `SELECT customer_id, size_id, SUM(dispatched) - SUM(returned) + SUM(adjustment) AS outstanding
     FROM customer_ledger_entries
     WHERE entry_date <= ?
     GROUP BY customer_id, size_id`,
    [asOf],
  )
  const byCustomer = new Map<number, Map<number, number>>()
  for (const row of ledger) {
    const group = byCustomer.get(row.customer_id) ?? new Map<number, number>()
    group.set(row.size_id, Number(row.outstanding))
    byCustomer.set(row.customer_id, group)
  }
  const people = db.select().from(customers).all()
  const threshold = Number(setting(db, 'overdue_threshold_days', '30'))
  const items: MonthEndItem[] = []
  for (const person of people) {
    const sizeMap = byCustomer.get(person.id) ?? new Map<number, number>()
    const balances: Record<string, number> = {}
    let total = 0
    for (const size of sizes) {
      const quantity = Number(sizeMap.get(size.id) ?? 0)
      balances[size.code] = quantity
      total += quantity
    }
    if (total <= 0) continue
    const lastDispatch = one<{ d: string | null }>(
      ctx,
      `SELECT MAX(dispatch_date) AS d FROM dispatches WHERE customer_id = ? AND dispatch_date <= ? AND reversed_at IS NULL`,
      [person.id, asOf],
    )?.d ?? null
    const lastReturn = one<{ d: string | null }>(
      ctx,
      `SELECT MAX(return_date) AS d FROM returns WHERE customer_id = ? AND return_date <= ? AND reversed_at IS NULL`,
      [person.id, asOf],
    )?.d ?? null
    const lastEntry = one<{ d: string | null }>(
      ctx,
      `SELECT MAX(entry_date) AS d FROM customer_ledger_entries WHERE customer_id = ? AND entry_date <= ?`,
      [person.id, asOf],
    )?.d ?? null
    const movement = [lastDispatch, lastReturn, lastEntry].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
    const days = movement ? daysBetween(asOf, movement) : null
    items.push({
      customerId: person.id,
      customerName: person.partyName,
      mobile: person.mobile ?? '',
      balances,
      totalOutstanding: total,
      lastDispatchDate: lastDispatch,
      lastReturnDate: lastReturn,
      daysSinceMovement: days,
      overdue: days !== null && days >= threshold,
    })
  }
  const created = db
    .insert(monthEndSnapshots)
    .values({
      periodKey: period,
      periodLabel: periodLabel(period),
      asOfDate: asOf,
      generatedAt: nowIso(ctx.now()),
      totalWithCustomers: items.reduce((sum, item) => sum + item.totalOutstanding, 0),
      customerCount: items.length,
    })
    .returning()
    .all()[0]
  if (!created) throw new BusinessError('Month-end snapshot could not be saved.')
  for (const item of items) {
    db.insert(monthEndSnapshotItems)
      .values({
        snapshotId: created.id,
        customerId: item.customerId,
        customerName: item.customerName,
        mobile: item.mobile || null,
        balancesJson: JSON.stringify(item.balances),
        totalOutstanding: item.totalOutstanding,
        lastDispatchDate: item.lastDispatchDate,
        lastReturnDate: item.lastReturnDate,
        daysSinceMovement: item.daysSinceMovement,
        overdue: item.overdue ? 1 : 0,
      })
      .run()
  }
  return { snapshot: created, items }
}

export function ensureMonthEnd(ctx: AppContext): { periods: string[]; notifications: { title: string; body: string; periodKey: string }[] } {
  return inTx(ctx, (db) => {
    const now = ctx.now()
    const current = monthKey(now)
    const installed = setting(db, 'installed_on', nowIso(now)).slice(0, 7)
    const earliest = one<{ d: string | null }>(
      ctx,
      `SELECT MIN(d) AS d FROM (
         SELECT MIN(entry_date) AS d FROM customer_ledger_entries
         UNION ALL SELECT MIN(dispatch_date) FROM dispatches
         UNION ALL SELECT MIN(return_date) FROM returns
         UNION ALL SELECT MIN(substr(recorded_at, 1, 10)) FROM opening_balances
       )`,
    )?.d
    const candidates = [installed, earliest?.slice(0, 7)].filter((value): value is string => Boolean(value)).sort()
    const start = candidates[0] || current
    const lastEnded = shiftMonth(current, -1)
    if (start > lastEnded) return { periods: [], notifications: [] }
    const notify = setting(db, 'notify_month_end', 'true') !== 'false'
    const created: string[] = []
    const notes: { title: string; body: string; periodKey: string }[] = []
    for (const period of monthsBetweenInclusive(start, lastEnded)) {
      const existing = db.select().from(monthEndSnapshots).where(eq(monthEndSnapshots.periodKey, period)).get()
      if (existing) continue
      const { snapshot } = createSnapshot(ctx, db, period)
      created.push(period)
      if (!notify) continue
      const title = `${snapshot.periodLabel} cylinder holding`
      const body =
        snapshot.customerCount === 0
          ? 'No cylinders were outstanding with customers.'
          : `${formatCount(snapshot.totalWithCustomers)} cylinders held by ${snapshot.customerCount} customer${snapshot.customerCount === 1 ? '' : 's'}.`
      db.insert(notifications)
        .values({
          kind: 'month-end',
          title,
          body,
          payloadJson: JSON.stringify({ periodKey: period }),
          createdAt: nowIso(now),
          dedupeKey: `month-end:${period}`,
        })
        .run()
      notes.push({ title, body, periodKey: period })
    }
    return { periods: created, notifications: notes }
  })
}
