import { desc } from 'drizzle-orm'
import { monthKey, recentMonthKeys, todayIso } from '@shared/dates'
import type { DashboardData } from '@shared/types'
import type { AppContext } from '../db/database'
import { one, rows, setting } from '../db/database'
import { auditLogs } from '../db/schema'
import { listSizeBalances } from './inventory'
import { holdingPositions } from './ledger'

export function getDashboard(ctx: AppContext): DashboardData {
  const now = ctx.now()
  const today = todayIso(now)
  const monthStart = `${monthKey(now)}-01`
  const sizes = listSizeBalances(ctx.db)
  const totals = sizes.reduce(
    (sum, size) => {
      sum.owned += size.owned
      sum.available += size.available
      sum.withCustomers += size.withCustomers
      sum.filled += size.filled
      sum.empty += size.empty
      sum.damaged += size.damaged
      sum.lost += size.lost
      sum.maintenance += size.maintenance
      return sum
    },
    { owned: 0, available: 0, withCustomers: 0, filled: 0, empty: 0, damaged: 0, lost: 0, maintenance: 0 },
  )
  const activeCustomers = Number(
    one<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM customers WHERE archived_at IS NULL AND status = 'active'`)?.n ?? 0,
  )
  const holdings = holdingPositions(ctx)
  const overdue = holdings.filter((row) => row.overdue)
  const dispatchMonth = one<{ docs: number; qty: number }>(
    ctx,
    `SELECT COUNT(DISTINCT d.id) AS docs, COALESCE(SUM(i.quantity), 0) AS qty
     FROM dispatches d
     LEFT JOIN dispatch_items i ON i.dispatch_id = d.id
     WHERE d.reversed_at IS NULL AND d.dispatch_date >= ? AND d.dispatch_date <= ?`,
    [monthStart, today],
  )
  const returnMonth = one<{ docs: number; qty: number }>(
    ctx,
    `SELECT COUNT(DISTINCT r.id) AS docs, COALESCE(SUM(i.quantity), 0) AS qty
     FROM returns r
     LEFT JOIN return_items i ON i.return_id = r.id
     WHERE r.reversed_at IS NULL AND r.return_date >= ? AND r.return_date <= ?`,
    [monthStart, today],
  )
  const months = recentMonthKeys(now, 12)
  const dispatchSeries = rows<{ month: string; qty: number }>(
    ctx,
    `SELECT substr(d.dispatch_date, 1, 7) AS month, COALESCE(SUM(i.quantity), 0) AS qty
     FROM dispatches d
     JOIN dispatch_items i ON i.dispatch_id = d.id
     WHERE d.reversed_at IS NULL AND d.dispatch_date >= ?
     GROUP BY substr(d.dispatch_date, 1, 7)`,
    [months[0]?.key + '-01'],
  )
  const returnSeries = rows<{ month: string; qty: number }>(
    ctx,
    `SELECT substr(r.return_date, 1, 7) AS month, COALESCE(SUM(i.quantity), 0) AS qty
     FROM returns r
     JOIN return_items i ON i.return_id = r.id
     WHERE r.reversed_at IS NULL AND r.return_date >= ?
     GROUP BY substr(r.return_date, 1, 7)`,
    [months[0]?.key + '-01'],
  )
  const dispatchMap = new Map(dispatchSeries.map((row) => [row.month, Number(row.qty)]))
  const returnMap = new Map(returnSeries.map((row) => [row.month, Number(row.qty)]))
  const snapshots = rows<{ period_key: string; period_label: string; total_with_customers: number }>(
    ctx,
    `SELECT period_key, period_label, total_with_customers FROM month_end_snapshots ORDER BY period_key ASC`,
  )
  const recent = ctx.db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(8).all()
  const openingCount = Number(one<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM opening_balances`)?.n ?? 0)
  return {
    totals: {
      ...totals,
      activeCustomers,
      customersHolding: holdings.length,
      dispatchesThisMonth: Number(dispatchMonth?.docs ?? 0),
      dispatchQtyThisMonth: Number(dispatchMonth?.qty ?? 0),
      returnsThisMonth: Number(returnMonth?.docs ?? 0),
      returnQtyThisMonth: Number(returnMonth?.qty ?? 0),
      overdueCustomers: overdue.length,
      overdueCylinders: overdue.reduce((sum, row) => sum + row.total, 0),
    },
    sizes,
    monthly: months.map((month) => ({
      month: month.key,
      label: month.label,
      dispatched: dispatchMap.get(month.key) ?? 0,
      returned: returnMap.get(month.key) ?? 0,
    })),
    distribution: sizes.map((size) => ({ name: size.name, code: size.code, value: size.owned })),
    topCustomers: holdings.slice(0, 10).map((row) => ({ id: row.customerId, name: row.partyName, total: row.total })),
    outstandingTrend: [
      ...snapshots.map((row) => ({ label: row.period_label.replace(/^\w+\s/, (value) => value.slice(0, 3) + ' '), total: Number(row.total_with_customers) })),
      { label: 'Now', total: totals.withCustomers },
    ],
    recent: recent.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      summary: row.summary,
      action: row.action,
      actor: row.actor,
    })),
    hasOpening: openingCount > 0,
    demoLoaded: setting(ctx.db, 'demo_loaded', 'false') === 'true',
  }
}
