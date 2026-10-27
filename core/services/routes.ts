import { asc, eq } from 'drizzle-orm'
import type { AppContext, Db } from '../db/database'
import type { RouteDetail } from '@shared/types'
import { routes } from '../db/schema'
import { BusinessError } from './errors'
import { stamp, writeAudit, actorName } from './stock'

export type RouteRow = { id: number; name: string; isActive: boolean; createdAt: string; updatedAt: string }

function map(row: typeof routes.$inferSelect): RouteRow {
  return { id: row.id, name: row.name, isActive: Boolean(row.isActive), createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function assertUniqueName(ctx: AppContext, name: string, id?: number) {
  const duplicate = ctx.sqlite.prepare('SELECT id FROM routes WHERE lower(name) = lower(?) AND id <> COALESCE(?, -1) LIMIT 1').get(name, id ?? null) as { id: number } | undefined
  if (duplicate) throw new BusinessError('A route with this name already exists.')
}

export function listRoutes(ctx: AppContext) {
  return ctx.db.select().from(routes).orderBy(asc(routes.name)).all().map(map)
}

export function requireRoute(db: Db, id: number | null | undefined, options: { active?: boolean } = {}) {
  if (id === null || id === undefined) return null
  const route = db.select().from(routes).where(eq(routes.id, id)).get()
  if (!route) throw new BusinessError('Route not found.')
  if (options.active !== false && !route.isActive) throw new BusinessError('This route is inactive. Choose an active route.')
  return route
}

export function createRoute(ctx: AppContext, input: { name: string }) {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 80) throw new BusinessError('Route name must be between 2 and 80 characters.')
  assertUniqueName(ctx, name)
  const now = stamp(ctx.now()).createdAt
  try {
    const row = ctx.db.insert(routes).values({ name, isActive: 1, createdAt: now, updatedAt: now }).returning().all()[0]
    if (!row) throw new BusinessError('Route could not be created.')
    writeAudit(ctx.db, { occurredAt: now, actor: actorName(ctx.db), action: 'create', entityType: 'route', entityId: String(row.id), summary: `Created route ${row.name}.` })
    return map(row)
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) throw new BusinessError('A route with this name already exists.')
    throw error
  }
}

export function updateRoute(ctx: AppContext, input: { id: number; name: string; isActive: boolean }) {
  const current = requireRoute(ctx.db, input.id, { active: false })
  if (!current) throw new BusinessError('Route not found.')
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 80) throw new BusinessError('Route name must be between 2 and 80 characters.')
  assertUniqueName(ctx, name, input.id)
  const updated = ctx.db.update(routes).set({ name, isActive: input.isActive ? 1 : 0, updatedAt: stamp(ctx.now()).createdAt }).where(eq(routes.id, input.id)).returning().all()[0]
  if (!updated) throw new BusinessError('Route could not be updated.')
  const action = current.name !== updated.name ? 'update' : current.isActive !== updated.isActive ? (input.isActive ? 'activate' : 'deactivate') : 'update'
  writeAudit(ctx.db, { occurredAt: updated.updatedAt, actor: actorName(ctx.db), action, entityType: 'route', entityId: String(updated.id), summary: `${action === 'update' ? 'Updated' : action === 'activate' ? 'Activated' : 'Deactivated'} route ${updated.name}.` })
  return map(updated)
}

export function deleteRoute(ctx: AppContext, id: number) {
  const current = requireRoute(ctx.db, id, { active: false })
  if (!current) throw new BusinessError('Route not found.')
  const dispatchUse = ctx.sqlite.prepare('SELECT 1 FROM dispatches WHERE route_id = ? LIMIT 1').get(id)
  const returnUse = ctx.sqlite.prepare('SELECT 1 FROM returns WHERE route_id = ? LIMIT 1').get(id)
  const customerUse = ctx.sqlite.prepare('SELECT 1 FROM customers WHERE route_id = ? LIMIT 1').get(id)
  if (dispatchUse || returnUse || customerUse) throw new BusinessError('This route is assigned to customers or used by transaction history. Deactivate it instead of deleting it.')
  ctx.db.delete(routes).where(eq(routes.id, id)).run()
  writeAudit(ctx.db, { occurredAt: stamp(ctx.now()).createdAt, actor: actorName(ctx.db), action: 'delete', entityType: 'route', entityId: String(id), summary: `Deleted route ${current.name}.` })
  return { deleted: true as const }
}

export function routeDetail(ctx: AppContext, input: { routeId: number; search?: string }) {
  const route = requireRoute(ctx.db, input.routeId, { active: false })
  if (!route) throw new BusinessError('Route not found.')
  const pattern = `%${(input.search ?? '').trim().toLowerCase()}%`
  const history = ctx.sqlite.prepare(`
    SELECT * FROM (
      SELECT d.id, 'dispatch' AS type, d.number, d.dispatch_date AS date, c.party_name AS customer_name,
      COALESCE(d.challan_number, '') AS challan, COALESCE(SUM(di.quantity), 0) AS quantity, d.reversed_at IS NOT NULL AS reversed
      FROM dispatches d JOIN customers c ON c.id = d.customer_id JOIN dispatch_items di ON di.dispatch_id = d.id
      WHERE d.route_id = ? GROUP BY d.id
      UNION ALL
      SELECT r.id, 'return' AS type, r.number, r.return_date AS date, c.party_name AS customer_name,
      COALESCE(r.challan_reference, '') AS challan, COALESCE(SUM(ri.quantity), 0) AS quantity, r.reversed_at IS NOT NULL AS reversed
      FROM returns r JOIN customers c ON c.id = r.customer_id JOIN return_items ri ON ri.return_id = r.id
      WHERE r.route_id = ? GROUP BY r.id
    )
    ORDER BY date DESC, id DESC
  `).all(input.routeId, input.routeId) as { id: number; type: 'dispatch' | 'return'; number: string; date: string; customer_name: string; quantity: number; challan: string; reversed: number }[]

  const search = (input.search ?? '').trim().toLowerCase()
  const customers = ctx.sqlite.prepare(`
    SELECT id AS customer_id, code AS customer_code, party_name AS customer_name,
      COALESCE(mobile, '') AS mobile, COALESCE(city, '') AS city, status,
      COALESCE((SELECT SUM(outstanding) FROM customer_balances cb WHERE cb.customer_id = customers.id), 0) AS total_outstanding
    FROM customers
    WHERE route_id = ?
      AND (? = '' OR lower(party_name) LIKE '%' || ? || '%'
        OR lower(code) LIKE '%' || ? || '%'
        OR lower(COALESCE(mobile, '')) LIKE '%' || ? || '%'
        OR lower(COALESCE(city, '')) LIKE '%' || ? || '%')
    ORDER BY lower(party_name), id
  `).all(input.routeId, search, search, search, search, search) as {
    customer_id: number
    customer_code: string
    customer_name: string
    mobile: string
    city: string
    status: 'active' | 'inactive'
    total_outstanding: number
  }[]

  // Holdings follow the customer's current route assignment. Transaction
  // route IDs are historical and remain reserved for the history query above.
  const customerIds = ctx.sqlite.prepare('SELECT id AS customer_id FROM customers WHERE route_id = ?').all(input.routeId) as { customer_id: number }[]
  const holdings: RouteDetail['holdings'] = []
  for (const { customer_id: customerId } of customerIds) {
    const rows = ctx.sqlite.prepare(`
      SELECT c.id AS customer_id, c.code AS customer_code, c.party_name AS customer_name,
        COALESCE(c.mobile, '') AS mobile, COALESCE(c.city, '') AS city,
        cs.name AS size_name, cb.size_id AS size_id, cb.outstanding AS quantity,
        COALESCE((SELECT group_concat(challan, ' ') FROM (
          SELECT COALESCE(d.challan_number, '') AS challan
          FROM dispatches d WHERE d.route_id = ? AND d.customer_id = c.id
          UNION ALL
          SELECT COALESCE(r.challan_reference, '') AS challan
          FROM returns r WHERE r.route_id = ? AND r.customer_id = c.id
        ) WHERE challan <> ''), '') AS challans
      FROM customers c
      JOIN customer_balances cb ON cb.customer_id = c.id
      JOIN cylinder_sizes cs ON cs.id = cb.size_id
      WHERE c.id = ? AND cb.outstanding > 0
      ORDER BY cs.sort_order, cs.id
    `).all(input.routeId, input.routeId, customerId) as { customer_id: number; customer_code: string; customer_name: string; mobile: string; city: string; size_name: string; size_id: number; quantity: number; challans: string }[]
    for (const row of rows) {
      const serials = ctx.sqlite.prepare(`
        SELECT DISTINCT cy.serial_number
        FROM cylinders cy
        WHERE cy.customer_id = ? AND cy.size_id = ? AND cy.status = 'with_customer'
        ORDER BY cy.serial_number
      `).all(customerId, row.size_id) as { serial_number: string }[]
      const haystack = `${row.customer_code} ${row.customer_name} ${row.mobile} ${row.city} ${row.size_name} ${row.challans} ${serials.map((item) => item.serial_number).join(' ')}`.toLowerCase()
      if (!pattern || haystack.includes(search)) holdings.push({ customerId: row.customer_id, customerName: row.customer_name, mobile: row.mobile, sizeName: row.size_name, serialNumbers: serials.map((item) => item.serial_number), quantity: row.quantity })
    }
  }
  return {
    route: { id: route.id, name: route.name, isActive: Boolean(route.isActive) },
    customers: customers.map((item) => ({ customerId: item.customer_id, customerCode: item.customer_code, customerName: item.customer_name, mobile: item.mobile, city: item.city, status: item.status, totalOutstanding: Number(item.total_outstanding) })),
    holdings,
    history: history.filter((item) => !search || `${item.number} ${item.customer_name} ${item.challan}`.toLowerCase().includes(search)).map((item) => ({ id: item.id, type: item.type, number: item.number, date: item.date, customerName: item.customer_name, quantity: item.quantity, challan: item.challan, reversed: Boolean(item.reversed) })),
  }
}
