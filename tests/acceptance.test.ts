import { afterEach, describe, expect, it } from 'vitest'
import { CHANNELS } from '../shared/channels'
import { buildHandlers } from '../core/handlers'
import { invokeHandler } from '../core/invoke'
import { consistencyProblems } from '../core/services/stock'
import { createCustomer, getCustomer } from '../core/services/customers'
import { createDispatch, createReturn } from '../core/services/documents'
import { listSizeBalances, setOpeningBalances } from '../core/services/inventory'
import { listLedger } from '../core/services/ledger'
import { fakeHost, tempContext } from './helpers'

const contexts: { close: () => void }[] = []
afterEach(() => {
  while (contexts.length) contexts.pop()?.close()
})

function world() {
  const env = tempContext()
  contexts.push(env)
  return env
}

describe('cylinder acceptance', () => {
  it('dispatches and partially returns multiple sizes without breaking balances', () => {
    const { ctx, sizes } = world()
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    setOpeningBalances(ctx, {
      rows: [
        { sizeId: sizes['3L'], filled: 100, empty: 0, damaged: 0, maintenance: 0, notes: '' },
        { sizeId: sizes['10L'], filled: 200, empty: 0, damaged: 0, maintenance: 0, notes: '' },
        { sizeId: sizes['23L'], filled: 300, empty: 0, damaged: 0, maintenance: 0, notes: '' },
      ],
    })
    const customer = createCustomer(ctx, {
      partyName: 'Customer A',
      contactPerson: 'Asha',
      mobile: '9845000001',
      alternateMobile: '',
      email: '',
      gstNumber: '',
      billingAddress: '',
      deliveryAddress: '',
      city: 'Pune',
      state: 'Maharashtra',
      pinCode: '411001',
      status: 'active',
      notes: '',
      openingBalances: [],
    })
    createDispatch(ctx, {
      date,
      customerId: customer.id,
      vehicleNumber: '',
      challanNumber: 'CH-1',
      driverName: '',
      remarks: 'Acceptance dispatch',
      lines: [
        { sizeId: sizes['3L'], quantity: 10, condition: 'filled' },
        { sizeId: sizes['10L'], quantity: 20, condition: 'filled' },
        { sizeId: sizes['23L'], quantity: 30, condition: 'filled' },
      ],
    })
    let balances = Object.fromEntries(listSizeBalances(ctx.db).map((size) => [size.code, size]))
    expect(balances['3L'].available).toBe(90)
    expect(balances['10L'].available).toBe(180)
    expect(balances['23L'].available).toBe(270)
    let profile = getCustomer(ctx, customer.id)
    expect(profile.balances.find((item) => item.code === '3L')?.outstanding).toBe(10)
    expect(profile.balances.find((item) => item.code === '10L')?.outstanding).toBe(20)
    expect(profile.balances.find((item) => item.code === '23L')?.outstanding).toBe(30)
    expect(profile.totalOutstanding).toBe(60)

    createReturn(ctx, {
      date,
      customerId: customer.id,
      challanReference: 'CH-1',
      remarks: 'Partial return',
      lines: [
        { sizeId: sizes['3L'], quantity: 5, condition: 'filled' },
        { sizeId: sizes['10L'], quantity: 10, condition: 'filled' },
        { sizeId: sizes['23L'], quantity: 15, condition: 'filled' },
      ],
      allowReconciliation: false,
      reconciliationReason: '',
    })
    balances = Object.fromEntries(listSizeBalances(ctx.db).map((size) => [size.code, size]))
    expect(balances['3L'].available).toBe(95)
    expect(balances['10L'].available).toBe(190)
    expect(balances['23L'].available).toBe(285)
    expect(balances['3L'].owned).toBe(100)
    profile = getCustomer(ctx, customer.id)
    expect(profile.balances.find((item) => item.code === '3L')?.outstanding).toBe(5)
    expect(profile.balances.find((item) => item.code === '10L')?.outstanding).toBe(10)
    expect(profile.balances.find((item) => item.code === '23L')?.outstanding).toBe(15)
    const ledger = listLedger(ctx, { page: 1, pageSize: 20, customerId: customer.id, sizeId: sizes['3L'], sortDir: 'asc' })
    expect(ledger.rows.at(-1)?.closingBalance).toBe(5)
    expect(ledger.summary.closing).toBe(5)
    expect(consistencyProblems(ctx.db)).toEqual([])
  })

  it('exposes every allowlisted channel through the handler map', async () => {
    const { ctx, dir } = world()
    const handlers = buildHandlers(ctx, fakeHost(dir, ctx))
    expect(Object.keys(handlers).sort()).toEqual([...CHANNELS].sort())
    const result = await invokeHandler(handlers, 'dashboard:get', {})
    expect(result.ok).toBe(true)
    const blocked = await invokeHandler(handlers, 'system:shutdown', {})
    expect(blocked.ok).toBe(false)
  })
})
