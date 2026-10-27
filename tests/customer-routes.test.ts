import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createCustomer, getCustomer, listCustomers, updateCustomer } from '../core/services/customers'
import { createDispatch, getDispatch } from '../core/services/documents'
import { createRoute, deleteRoute, routeDetail, updateRoute } from '../core/services/routes'
import { setOpeningBalances } from '../core/services/inventory'
import { closeDatabase, openDatabase } from '../core/db/database'
import { tempContext } from './helpers'

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
  it('adds route columns and indexes to an existing current database', () => {
    const env = tempContext()
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
    createCustomer(env.ctx, fields({ routeId: active.id }))
    expect(() => deleteRoute(env.ctx, active.id)).toThrow('assigned')
  })
})

describe('route detail and document route snapshots', () => {
  it('searches assigned customers and preserves the route name on documents after rename', () => {
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
    updateRoute(env.ctx, { id: route.id, name: 'Renamed route', isActive: true })
    expect(getDispatch(env.ctx, dispatch.id).routeName).toBe('Original route')

    const detail = routeDetail(env.ctx, { routeId: route.id, search: customer.code })
    expect(detail.customers).toEqual([{ customerId: customer.id, customerCode: customer.code, customerName: customer.partyName, mobile: customer.mobile, city: customer.city, status: customer.status }])
    expect(routeDetail(env.ctx, { routeId: route.id }).history).toHaveLength(1)
  })
})
