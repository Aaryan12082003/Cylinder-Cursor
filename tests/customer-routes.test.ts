import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { RouteDetail } from '@shared/types'
import { createCustomer, getCustomer, listCustomers, updateCustomer } from '../core/services/customers'
import { createDispatch, editDispatch, getDispatch } from '../core/services/documents'
import { createRoute, deleteRoute, routeDetail, updateRoute } from '../core/services/routes'
import { setOpeningBalances } from '../core/services/inventory'
import { closeDatabase, openDatabase } from '../core/db/database'
import { buildHandlers } from '../core/handlers'
import { invokeHandler } from '../core/invoke'
import { fakeHost, tempContext } from './helpers'

const open: { close: () => void }[] = []
afterEach(() => {
  while (open.length) open.pop()?.close()
})

function fields(extra: Record<string, unknown> = {}) {
  return {
    partyName: 'Route Customer',
    contactPerson: '',
    mobile: '9845011122',
    alternateMobile: '',
    email: '',
    gstNumber: '',
    billingAddress: '',
    deliveryAddress: '',
    city: 'Surat',
    state: 'Gujarat',
    pinCode: '395003',
    status: 'active' as const,
    notes: '',
    openingBalances: [],
    ...extra,
  }
}

describe('customer route assignment', () => {
  it('matches a new customer city to one active route and preserves the assignment on ordinary edits', () => {
    const env = tempContext()
    open.push(env)
    const cityRoute = createRoute(env.ctx, { name: 'Mumbai' })
    const legacyRoute = createRoute(env.ctx, { name: 'Legacy route' })
    const customer = createCustomer(env.ctx, fields({ city: '  mUMbai  ', routeId: legacyRoute.id }))

    // A city match is authoritative for new records, even when an older
    // caller still sends an unrelated routeId.
    expect(customer.routeId).toBe(cityRoute.id)
    expect(customer.routeName).toBe(cityRoute.name)

    const edited = updateCustomer(env.ctx, { id: customer.id, ...fields({ city: 'Pune' }) })
    expect(edited.routeId).toBe(cityRoute.id)

    const explicitlyChanged = updateCustomer(env.ctx, { id: customer.id, ...fields({ city: 'Pune', routeId: legacyRoute.id }) })
    expect(explicitlyChanged.routeId).toBe(legacyRoute.id)
  })

  it('backfills unassigned customers when a route is created, renamed, or activated', () => {
    let now = new Date('2026-10-27T10:00:00.000Z')
    const env = tempContext(() => now)
    open.push(env)
    const unassigned = createCustomer(env.ctx, fields({ city: 'Jaipur' }))
    const explicitRoute = createRoute(env.ctx, { name: 'Explicit route' })
    const explicitlyAssigned = createCustomer(env.ctx, fields({ city: 'Jaipur', routeId: explicitRoute.id, mobile: '9845011123' }))

    now = new Date('2026-10-27T10:01:00.000Z')
    const created = createRoute(env.ctx, { name: ' jaIPUR ' })
    expect(getCustomer(env.ctx, unassigned.id).routeId).toBe(created.id)
    expect(getCustomer(env.ctx, unassigned.id).updatedAt).toBe(now.toISOString())
    expect(getCustomer(env.ctx, explicitlyAssigned.id).routeId).toBe(explicitRoute.id)

    const dormant = createRoute(env.ctx, { name: 'Kota' })
    updateRoute(env.ctx, { id: dormant.id, name: dormant.name, isActive: false })
    const waiting = createCustomer(env.ctx, fields({ city: ' kota ', mobile: '9845011124' }))
    expect(waiting.routeId).toBeNull()
    now = new Date('2026-10-27T10:02:00.000Z')
    updateRoute(env.ctx, { id: dormant.id, name: dormant.name, isActive: true })
    expect(getCustomer(env.ctx, waiting.id).routeId).toBe(dormant.id)

    const renameTarget = createCustomer(env.ctx, fields({ city: 'Udaipur', mobile: '9845011125' }))
    const renamed = createRoute(env.ctx, { name: 'Old Udaipur route' })
    updateRoute(env.ctx, { id: renamed.id, name: ' udaipur ', isActive: true })
    expect(getCustomer(env.ctx, renameTarget.id).routeId).toBe(renamed.id)
  })

  it('backfills an unassigned legacy customer only when its city has one active route match', () => {
    const env = tempContext()
    const customer = createCustomer(env.ctx, fields({ city: 'Rajkot' }))
    const timestamp = new Date().toISOString()
    env.ctx.sqlite.prepare('INSERT INTO routes (name, is_active, created_at, updated_at) VALUES (?, 1, ?, ?)').run('rajkot', timestamp, timestamp)
    const route = env.ctx.sqlite.prepare('SELECT id FROM routes WHERE name = ?').get('rajkot') as { id: number }
    const path = env.ctx.path
    env.close()
    const reopened = openDatabase(path)
    open.push({ close: () => closeDatabase(reopened) })

    expect(getCustomer(reopened, customer.id).routeId).toBe(route.id)
  })

  it('adds route columns and indexes to an existing current database', () => {
    const env = tempContext()
    setOpeningBalances(env.ctx, { rows: [{ sizeId: env.sizes['3L'], filled: 2, empty: 0, damaged: 0, maintenance: 0, notes: '' }] })
    const route = createRoute(env.ctx, { name: 'Migrated route' })
    const customer = createCustomer(env.ctx, fields({ routeId: route.id }))
    const dispatch = createDispatch(env.ctx, {
      date: '2026-10-27',
      customerId: customer.id,
      routeId: route.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 1, condition: 'filled' }],
    })
    env.ctx.sqlite.prepare('UPDATE dispatches SET route_name = NULL WHERE id = ?').run(dispatch.id)
    const path = env.ctx.path
    env.close()
    const sqlite = new Database(path)
    sqlite.exec('DROP INDEX idx_customers_route; ALTER TABLE customers DROP COLUMN route_id; ALTER TABLE dispatches DROP COLUMN route_name; ALTER TABLE returns DROP COLUMN route_name;')
    sqlite.close()

    const reopened = openDatabase(path)
    open.push({ close: () => closeDatabase(reopened) })
    expect((reopened.sqlite.prepare('PRAGMA table_info(customers)').all() as { name: string }[]).some((column) => column.name === 'route_id')).toBe(true)
    expect(reopened.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_customers_route'").get()).toBeTruthy()
    expect((reopened.sqlite.prepare('PRAGMA table_info(dispatches)').all() as { name: string }[]).some((column) => column.name === 'route_name')).toBe(true)
    expect((reopened.sqlite.prepare('PRAGMA table_info(returns)').all() as { name: string }[]).some((column) => column.name === 'route_name')).toBe(true)
    expect(getDispatch(reopened, dispatch.id).routeName).toBe('Migrated route')
    updateRoute(reopened, { id: route.id, name: 'Renamed after migration', isActive: true })
    expect(getDispatch(reopened, dispatch.id).routeName).toBe('Migrated route')
  })

  it('assigns, changes, clears, and exposes route details on customer rows', () => {
    const env = tempContext()
    open.push(env)
    const north = createRoute(env.ctx, { name: 'North route' })
    const south = createRoute(env.ctx, { name: 'South route' })
    const customer = createCustomer(env.ctx, fields({ routeId: north.id }))
    expect(customer.routeId).toBe(north.id)
    expect(customer.routeName).toBe(north.name)

    const changed = updateCustomer(env.ctx, { id: customer.id, ...fields({ routeId: south.id }) })
    expect(changed.routeId).toBe(south.id)
    expect(getCustomer(env.ctx, customer.id).routeName).toBe(south.name)
    const preserved = updateCustomer(env.ctx, { id: customer.id, ...fields() })
    expect(preserved.routeId).toBe(south.id)
    const cleared = updateCustomer(env.ctx, { id: customer.id, ...fields({ routeId: null }) })
    expect(cleared.routeId).toBeNull()
    expect(cleared.routeName).toBe('')
    expect(listCustomers(env.ctx, { page: 1, pageSize: 10, status: 'all' }).rows[0]?.routeName).toBe('')

    expect(() => deleteRoute(env.ctx, north.id)).not.toThrow()
  })

  it('rejects inactive assignment and deleting an assigned route', () => {
    const env = tempContext()
    open.push(env)
    const route = createRoute(env.ctx, { name: 'Assigned route' })
    updateRoute(env.ctx, { id: route.id, name: route.name, isActive: false })
    expect(() => createCustomer(env.ctx, fields({ routeId: route.id }))).toThrow('inactive')

    const active = createRoute(env.ctx, { name: 'Active route' })
    const assigned = createCustomer(env.ctx, fields({ routeId: active.id }))
    updateRoute(env.ctx, { id: active.id, name: active.name, isActive: false })
    const saved = updateCustomer(env.ctx, { id: assigned.id, ...fields({ partyName: 'Updated assigned customer', routeId: active.id }) })
    expect(saved.routeId).toBe(active.id)
    expect(() => deleteRoute(env.ctx, active.id)).toThrow('assigned')
  })
})

describe('route detail and document route snapshots', () => {
  it('derives new documents from the customer and keeps the original route snapshot on edits', () => {
    const env = tempContext(() => new Date('2026-10-27T10:00:00.000Z'))
    open.push(env)
    setOpeningBalances(env.ctx, { rows: [{ sizeId: env.sizes['3L'], filled: 4, empty: 0, damaged: 0, maintenance: 0, notes: '' }] })
    const assigned = createRoute(env.ctx, { name: 'Assigned route' })
    const unrelated = createRoute(env.ctx, { name: 'Unrelated route' })
    const customer = createCustomer(env.ctx, fields({ city: 'No matching city', routeId: assigned.id }))

    const input = {
      date: '2026-10-27',
      customerId: customer.id,
      routeId: unrelated.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 1, condition: 'filled' as const }],
    }
    const dispatch = createDispatch(env.ctx, input)
    expect(dispatch.routeId).toBe(assigned.id)
    expect(dispatch.routeName).toBe(assigned.name)

    updateCustomer(env.ctx, { id: customer.id, ...fields({ city: 'No matching city', routeId: unrelated.id }) })
    const replacement = editDispatch(env.ctx, dispatch.id, { id: dispatch.id, ...input, routeId: unrelated.id })
    expect(replacement.routeId).toBe(assigned.id)
    expect(replacement.routeName).toBe(assigned.name)
  })

  it('searches assigned customers and preserves the route name on documents after rename', async () => {
    const env = tempContext(() => new Date('2026-10-27T10:00:00.000Z'))
    open.push(env)
    setOpeningBalances(env.ctx, { rows: [{ sizeId: env.sizes['3L'], filled: 5, empty: 0, damaged: 0, maintenance: 0, notes: '' }] })
    const route = createRoute(env.ctx, { name: 'Original route' })
    const customer = createCustomer(env.ctx, fields({ routeId: route.id, openingBalances: [] }))
    const dispatch = createDispatch(env.ctx, {
      date: '2026-10-27',
      customerId: customer.id,
      routeId: route.id,
      vehicleNumber: '',
      challanNumber: 'CH-1',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 1, condition: 'filled' }],
    })
    const zeroBalanceCustomer = createCustomer(env.ctx, fields({ partyName: 'Zero balance customer', routeId: route.id, mobile: '9845011123', city: 'Vadodara' }))
    const openingCustomer = createCustomer(env.ctx, fields({ partyName: 'Opening balance customer', routeId: route.id, mobile: '9845011124', city: 'Rajkot', openingBalances: [{ sizeId: env.sizes['3L'], quantity: 2 }] }))
    updateRoute(env.ctx, { id: route.id, name: 'Renamed route', isActive: true })
    expect(getDispatch(env.ctx, dispatch.id).routeName).toBe('Original route')

    const detail = routeDetail(env.ctx, { routeId: route.id, search: customer.code })
    expect(detail.customers).toEqual([{ customerId: customer.id, customerCode: customer.code, customerName: customer.partyName, mobile: customer.mobile, city: customer.city, status: customer.status, totalOutstanding: 1 }])
    expect(routeDetail(env.ctx, { routeId: route.id, search: customer.city }).customers).toHaveLength(1)
    expect(routeDetail(env.ctx, { routeId: route.id, search: '_' }).customers).toHaveLength(0)
    expect(routeDetail(env.ctx, { routeId: route.id, search: customer.code }).holdings).toHaveLength(1)
    expect(routeDetail(env.ctx, { routeId: route.id, search: customer.city }).holdings).toHaveLength(1)
    expect(routeDetail(env.ctx, { routeId: route.id, search: 'CH-1' }).holdings).toHaveLength(1)
    const apiResult = await invokeHandler(buildHandlers(env.ctx, fakeHost(env.dir, env.ctx)), 'routes:detail', { routeId: route.id, search: 'CH-1' })
    expect(apiResult.ok).toBe(true)
    if (apiResult.ok) expect((apiResult.data as RouteDetail).customers?.some((item) => item.customerId === customer.id)).toBe(true)
    expect(routeDetail(env.ctx, { routeId: route.id }).customers?.find((item) => item.customerId === zeroBalanceCustomer.id)?.totalOutstanding).toBe(0)
    expect(routeDetail(env.ctx, { routeId: route.id }).holdings).toEqual(expect.arrayContaining([{ customerId: openingCustomer.id, customerName: openingCustomer.partyName, mobile: openingCustomer.mobile, sizeName: '3 Litre', serialNumbers: [], quantity: 2 }]))
    expect(routeDetail(env.ctx, { routeId: route.id }).history).toHaveLength(1)
  })
})
