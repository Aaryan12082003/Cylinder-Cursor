import { afterEach, describe, expect, it } from 'vitest'
import { reportFilterSchema } from '../shared/schemas'
import { createCustomer } from '../core/services/customers'
import { createDispatch, createReturn } from '../core/services/documents'
import { createRoute } from '../core/services/routes'
import { setOpeningBalances } from '../core/services/inventory'
import { runReport } from '../core/services/reports'
import { tempContext } from './helpers'

const open: { close: () => void }[] = []
afterEach(() => { while (open.length) open.pop()?.close() })

function customerFields(extra: Record<string, unknown> = {}) {
  return {
    partyName: 'Route report party',
    contactPerson: '', mobile: '9845011122', alternateMobile: '', email: '', gstNumber: '',
    billingAddress: '', deliveryAddress: '', city: 'Jaipur', state: '', pinCode: '', status: 'active' as const,
    notes: '', openingBalances: [], ...extra,
  }
}

describe('route register report', () => {
  it('aggregates route status, zero-balance customers, current balances, and date-bounded movements', () => {
    const env = tempContext(() => new Date('2026-10-28T10:00:00.000Z'))
    open.push(env)
    setOpeningBalances(env.ctx, { rows: [{ sizeId: env.sizes['3L'], filled: 5, empty: 0, damaged: 0, maintenance: 0, notes: '' }] })
    const route = createRoute(env.ctx, { name: 'Jaipur' })
    const zero = createCustomer(env.ctx, customerFields({ partyName: 'Zero balance', mobile: '9845011123', routeId: route.id }))
    const holding = createCustomer(env.ctx, customerFields({ partyName: 'Holding party', routeId: route.id, mobile: '9845011124' }))
    const dispatch = createDispatch(env.ctx, {
      date: '2026-10-27', customerId: holding.id, routeId: route.id,
      vehicleNumber: '', challanNumber: 'CH-1', driverName: '', remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 2, condition: 'filled' }],
    })
    createReturn(env.ctx, {
      date: '2026-10-28', customerId: holding.id, challanReference: 'RT-1', remarks: '',
      allowReconciliation: false, reconciliationReason: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 1, condition: 'filled' }],
    })

    const parsed = reportFilterSchema.parse({ id: 'route-register', routeId: route.id, from: '2026-10-27', to: '2026-10-28' })
    const report = runReport(env.ctx, parsed)
    expect(report.id).toBe('route-register')
    expect(report.rows).toHaveLength(2)
    const zeroRow = report.rows.find((row) => row.customerId === zero.code)
    const holdingRow = report.rows.find((row) => row.customerId === holding.code)
    expect(zeroRow).toMatchObject({ route: 'Jaipur', status: 'Active', customer: 'Zero balance', mobile: '9845011123', '3L': 0, total: 0, dispatches: 0, returns: 0 })
    expect(holdingRow).toMatchObject({ route: 'Jaipur', status: 'Active', customer: 'Holding party', mobile: '9845011124', '3L': 1, total: 1, dispatches: 1, returns: 1 })
    expect(report.columns.map((column) => column.key)).toContain('3L')
    expect(report.summary).toEqual(expect.arrayContaining([
      { label: 'Customers', value: '2' },
      { label: 'Cylinders held', value: '1' },
    ]))
    void zero
    void dispatch
  })

  it('includes inactive routes and applies the route filter without dropping zero-balance assignments', () => {
    const env = tempContext()
    open.push(env)
    const inactive = createRoute(env.ctx, { name: 'Old route' })
    env.ctx.sqlite.prepare('UPDATE routes SET is_active = 0 WHERE id = ?').run(inactive.id)
    const inactiveCustomer = createCustomer(env.ctx, customerFields({ partyName: 'Inactive route party', city: 'Elsewhere' }))
    env.ctx.sqlite.prepare('UPDATE customers SET route_id = ? WHERE id = ?').run(inactive.id, inactiveCustomer.id)
    const report = runReport(env.ctx, reportFilterSchema.parse({ id: 'route-register', routeId: inactive.id }))
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ route: 'Old route', status: 'Inactive', customer: 'Inactive route party', total: 0, dispatches: 0, returns: 0 })

    const emptyRoute = createRoute(env.ctx, { name: 'No customers route' })
    const emptyRouteReport = runReport(env.ctx, reportFilterSchema.parse({ id: 'route-register', routeId: emptyRoute.id }))
    expect(emptyRouteReport.rows).toHaveLength(1)
    expect(emptyRouteReport.rows[0]).toMatchObject({ route: 'No customers route', status: 'Active', customerId: null, customer: null, total: 0, dispatches: 0, returns: 0 })
    expect(emptyRouteReport.summary).toEqual(expect.arrayContaining([{ label: 'Customers', value: '0' }]))
  })

  it('applies customer and size filters and remains valid when no active sizes qualify', () => {
    const env = tempContext()
    open.push(env)
    setOpeningBalances(env.ctx, { rows: [{ sizeId: env.sizes['3L'], filled: 4, empty: 0, damaged: 0, maintenance: 0, notes: '' }] })
    const route = createRoute(env.ctx, { name: 'Filtered route' })
    const customer = createCustomer(env.ctx, customerFields({ partyName: 'Filtered party', routeId: route.id }))
    createDispatch(env.ctx, {
      date: '2026-10-28', customerId: customer.id, routeId: route.id,
      vehicleNumber: '', challanNumber: '', driverName: '', remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 2, condition: 'filled' }],
    })
    const customerReport = runReport(env.ctx, reportFilterSchema.parse({ id: 'route-register', customerId: customer.id }))
    expect(customerReport.rows).toHaveLength(1)
    expect(customerReport.rows[0]).toMatchObject({ customerId: customer.code, customer: 'Filtered party', '3L': 2, total: 2 })

    const sizeReport = runReport(env.ctx, reportFilterSchema.parse({ id: 'route-register', sizeId: env.sizes['3L'] }))
    expect(sizeReport.columns.map((column) => column.key)).toContain('3L')
    expect(sizeReport.rows[0]).toMatchObject({ '3L': 2, total: 2 })

    const emptyEnv = tempContext()
    open.push(emptyEnv)
    const emptyRoute = createRoute(emptyEnv.ctx, { name: 'Empty sizes route' })
    createCustomer(emptyEnv.ctx, customerFields({ partyName: 'Empty sizes party', routeId: emptyRoute.id }))
    emptyEnv.ctx.sqlite.prepare('UPDATE cylinder_sizes SET is_active = 0').run()
    const emptySizeReport = runReport(emptyEnv.ctx, reportFilterSchema.parse({ id: 'route-register', routeId: emptyRoute.id }))
    expect(emptySizeReport.rows).toHaveLength(1)
    expect(emptySizeReport.rows[0]).toMatchObject({ customer: 'Empty sizes party', total: 0 })
    expect(emptySizeReport.columns.map((column) => column.key)).not.toContain('3L')
  })
})
