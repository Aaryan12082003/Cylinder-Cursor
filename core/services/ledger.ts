import { and, desc, eq, sql } from 'drizzle-orm'
import { daysBetween, todayIso } from '@shared/dates'
import type { LedgerRow, OutstandingRow, Page } from '@shared/types'
import type { AppContext } from '../db/database'
import { rows, setting } from '../db/database'
import { customerLedgerEntries, customers, cylinderSizes } from '../db/schema'
import { balancesFor } from './customers'
import { likePattern } from './text'

export type LedgerQuery = {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  customerId?: number
  sizeId?: number
  type?: string
  from?: string
  to?: string
}

export function holdingPositions(ctx: AppContext): OutstandingRow[] {
  const today = todayIso(ctx.now())
  const threshold = Number(setting(ctx.db, 'overdue_threshold_days', '30'))
  const people = ctx.db.select().from(customers).all()
  const balanceMap = balancesFor(
    ctx.db,
    people.map((person) => person.id),
  )
  const lastEntries = rows<{ customer_id: number; d: string | null }>(
    ctx,
    `SELECT customer_id, MAX(entry_date) AS d FROM customer_ledger_entries GROUP BY customer_id`,
  )
  const lastDispatches = rows<{ customer_id: number; d: string | null }>(
    ctx,
    `SELECT customer_id, MAX(dispatch_date) AS d FROM dispatches WHERE reversed_at IS NULL GROUP BY customer_id`,
  )
  const lastReturns = rows<{ customer_id: number; d: string | null }>(
    ctx,
    `SELECT customer_id, MAX(return_date) AS d FROM returns WHERE reversed_at IS NULL GROUP BY customer_id`,
  )
  const entryMap = new Map(lastEntries.map((row) => [row.customer_id, row.d]))
  const dispatchMap = new Map(lastDispatches.map((row) => [row.customer_id, row.d]))
  const returnMap = new Map(lastReturns.map((row) => [row.customer_id, row.d]))
  return people
    .map((person) => {
      const balances = balanceMap.get(person.id) ?? []
      const total = balances.reduce((sum, item) => sum + item.outstanding, 0)
      const lastDispatchDate = dispatchMap.get(person.id) ?? null
      const lastReturnDate = returnMap.get(person.id) ?? null
      const lastEntry = entryMap.get(person.id) ?? null
      const movement = [lastDispatchDate, lastReturnDate, lastEntry].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
      const daysSinceMovement = movement ? daysBetween(today, movement) : null
      return {
        customerId: person.id,
        code: person.code,
        partyName: person.partyName,
        mobile: person.mobile ?? '',
        city: person.city ?? '',
        status: person.archivedAt ? 'archived' : person.status,
        balances,
        total,
        lastDispatchDate,
        lastReturnDate,
        daysSinceMovement,
        overdue: total > 0 && daysSinceMovement !== null && daysSinceMovement >= threshold,
      }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.partyName.localeCompare(b.partyName))
}

export function listOutstanding(
  ctx: AppContext,
  query: { page: number; pageSize: number; search?: string; overdueOnly?: boolean },
): Page<OutstandingRow> {
  const search = query.search?.trim().toLowerCase() ?? ''
  const filtered = holdingPositions(ctx).filter((row) => {
    if (query.overdueOnly && !row.overdue) return false
    if (!search) return true
    return (
      row.partyName.toLowerCase().includes(search) ||
      row.mobile.toLowerCase().includes(search) ||
      row.code.toLowerCase().includes(search) ||
      row.city.toLowerCase().includes(search)
    )
  })
  const start = (query.page - 1) * query.pageSize
  return {
    rows: filtered.slice(start, start + query.pageSize),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
  }
}

export function listLedger(ctx: AppContext, query: LedgerQuery): Page<LedgerRow> & {
  summary: { dispatched: number; returned: number; adjustment: number; opening: number | null; closing: number | null }
} {
  const filters = []
  if (query.customerId) filters.push(eq(customerLedgerEntries.customerId, query.customerId))
  if (query.sizeId) filters.push(eq(customerLedgerEntries.sizeId, query.sizeId))
  if (query.type) filters.push(eq(customerLedgerEntries.transactionType, query.type))
  if (query.from) filters.push(sql`${customerLedgerEntries.entryDate} >= ${query.from}`)
  if (query.to) filters.push(sql`${customerLedgerEntries.entryDate} <= ${query.to}`)
  if (query.search?.trim()) {
    const pattern = likePattern(query.search)
    filters.push(sql`(
      lower(${customerLedgerEntries.transactionId}) like ${pattern} escape '\\'
      or lower(coalesce(${customerLedgerEntries.referenceNumber}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${customerLedgerEntries.remarks}, '')) like ${pattern} escape '\\'
      or lower(${customers.partyName}) like ${pattern} escape '\\'
    )`)
  }
  const where = filters.length ? and(...filters) : undefined
  const base = () =>
    ctx.db
      .select({
        entry: customerLedgerEntries,
        partyName: customers.partyName,
        sizeName: cylinderSizes.name,
        sizeCode: cylinderSizes.code,
      })
      .from(customerLedgerEntries)
      .innerJoin(customers, eq(customers.id, customerLedgerEntries.customerId))
      .innerJoin(cylinderSizes, eq(cylinderSizes.id, customerLedgerEntries.sizeId))
      .where(where)
  const total = Number(
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(customerLedgerEntries)
      .innerJoin(customers, eq(customers.id, customerLedgerEntries.customerId))
      .where(where)
      .get()?.n ?? 0,
  )
  const sums = ctx.db
    .select({
      dispatched: sql<number>`coalesce(sum(${customerLedgerEntries.dispatched}), 0)`,
      returned: sql<number>`coalesce(sum(${customerLedgerEntries.returned}), 0)`,
      adjustment: sql<number>`coalesce(sum(${customerLedgerEntries.adjustment}), 0)`,
    })
    .from(customerLedgerEntries)
    .innerJoin(customers, eq(customers.id, customerLedgerEntries.customerId))
    .where(where)
    .get()
  const ordered = base()
    .orderBy(
      query.sortDir === 'asc' ? customerLedgerEntries.entryDate : desc(customerLedgerEntries.entryDate),
      query.sortDir === 'asc' ? customerLedgerEntries.id : desc(customerLedgerEntries.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  let opening: number | null = null
  let closing: number | null = null
  if (query.customerId && query.sizeId) {
    const priorFilters = [
      eq(customerLedgerEntries.customerId, query.customerId),
      eq(customerLedgerEntries.sizeId, query.sizeId),
    ]
    if (query.from) priorFilters.push(sql`${customerLedgerEntries.entryDate} < ${query.from}`)
    const prior = query.from
      ? ctx.db
          .select()
          .from(customerLedgerEntries)
          .where(and(...priorFilters))
          .orderBy(desc(customerLedgerEntries.entryDate), desc(customerLedgerEntries.id))
          .get()
      : undefined
    opening = prior?.closingBalance ?? 0
    const last = ctx.db
      .select()
      .from(customerLedgerEntries)
      .where(where)
      .orderBy(desc(customerLedgerEntries.entryDate), desc(customerLedgerEntries.id))
      .get()
    closing = last?.closingBalance ?? opening
  }
  return {
    rows: ordered.map((row) => ({
      id: row.entry.id,
      date: row.entry.entryDate,
      transactionId: row.entry.transactionId,
      partyName: row.partyName,
      customerId: row.entry.customerId,
      sizeId: row.entry.sizeId,
      sizeName: row.sizeName,
      sizeCode: row.sizeCode,
      transactionType: row.entry.transactionType,
      openingBalance: row.entry.openingBalance,
      dispatched: row.entry.dispatched,
      returned: row.entry.returned,
      adjustment: row.entry.adjustment,
      closingBalance: row.entry.closingBalance,
      referenceNumber: row.entry.referenceNumber ?? '',
      remarks: row.entry.remarks ?? '',
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    summary: {
      dispatched: Number(sums?.dispatched ?? 0),
      returned: Number(sums?.returned ?? 0),
      adjustment: Number(sums?.adjustment ?? 0),
      opening,
      closing,
    },
  }
}
