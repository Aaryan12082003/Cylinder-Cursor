import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../core/db/database'
import { BusinessError } from '../core/services/errors'
import { createBackup, restoreFromFile } from '../core/services/backup'
import { createCustomer, getCustomer, listCustomers } from '../core/services/customers'
import { createDispatch, createReturn, reverseDispatch } from '../core/services/documents'
import { adjustInventory, listSizeBalances, reconcileCustomer, setOpeningBalances } from '../core/services/inventory'
import { ensureMonthEnd, getMonthEnd } from '../core/services/monthEnd'
import { unreadCount } from '../core/services/notifications'
import { reportToExcel, reportToPdf } from '../core/services/exports'
import { runReport } from '../core/services/reports'
import { consistencyProblems } from '../core/services/stock'
import { globalSearch } from '../core/services/search'
import { tempContext } from './helpers'

const open: { close: () => void }[] = []
afterEach(() => {
  while (open.length) open.pop()?.close()
})

function boot(now?: () => Date) {
  const env = tempContext(now)
  open.push(env)
  const date = `${env.ctx.now().getFullYear()}-${String(env.ctx.now().getMonth() + 1).padStart(2, '0')}-${String(env.ctx.now().getDate()).padStart(2, '0')}`
  setOpeningBalances(env.ctx, {
    rows: ['3L', '10L', '23L'].map((code) => ({
      sizeId: env.sizes[code],
      filled: code === '3L' ? 50 : 40,
      empty: 5,
      damaged: 0,
      maintenance: 0,
      notes: '',
    })),
  })
  const customer = createCustomer(env.ctx, {
    partyName: 'Harbour Metals',
    contactPerson: 'Nikhil',
    mobile: '9845011122',
    alternateMobile: '',
    email: 'ops@harbour.example',
    gstNumber: '24ABCDE1234F1Z5',
    billingAddress: 'Dock Road',
    deliveryAddress: '',
    city: 'Surat',
    state: 'Gujarat',
    pinCode: '395003',
    status: 'active',
    notes: '',
    openingBalances: [{ sizeId: env.sizes['3L'], quantity: 2 }],
  })
  return { ...env, date, customer }
}

describe('business rules', () => {
  it('keeps customer opening balances out of available stock', () => {
    const { ctx, sizes, customer } = boot()
    const size = listSizeBalances(ctx.db).find((item) => item.code === '3L')
    expect(size?.available).toBe(55)
    expect(size?.withCustomers).toBe(2)
    expect(size?.owned).toBe(57)
    expect(getCustomer(ctx, customer.id).balances.find((item) => item.sizeId === sizes['3L'])?.outstanding).toBe(2)
    expect(consistencyProblems(ctx.db)).toEqual([])
  })

  it('rolls back a dispatch when any line has insufficient stock', () => {
    const { ctx, sizes, date, customer } = boot()
    expect(() =>
      createDispatch(ctx, {
        date,
        customerId: customer.id,
        vehicleNumber: '',
        challanNumber: '',
        driverName: '',
        remarks: '',
        lines: [
          { sizeId: sizes['3L'], quantity: 1, condition: 'filled' },
          { sizeId: sizes['10L'], quantity: 999, condition: 'filled' },
        ],
      }),
    ).toThrow(BusinessError)
    expect(listSizeBalances(ctx.db).find((item) => item.code === '3L')?.filled).toBe(50)
    const rows = ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM dispatches').get() as { n: number }
    expect(rows.n).toBe(0)
  })

  it('rejects a return above outstanding unless reconciliation is authorized', () => {
    const { ctx, sizes, date, customer } = boot()
    createDispatch(ctx, {
      date,
      customerId: customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: sizes['10L'], quantity: 4, condition: 'empty' }],
    })
    expect(() =>
      createReturn(ctx, {
        date,
        customerId: customer.id,
        challanReference: '',
        remarks: '',
        lines: [{ sizeId: sizes['10L'], quantity: 5, condition: 'empty' }],
        allowReconciliation: false,
        reconciliationReason: '',
      }),
    ).toThrow(/outstanding/)
    expect(getCustomer(ctx, customer.id).balances.find((item) => item.code === '10L')?.outstanding).toBe(4)
    createReturn(ctx, {
      date,
      customerId: customer.id,
      challanReference: '',
      remarks: 'Counted extra cylinder',
      lines: [{ sizeId: sizes['10L'], quantity: 5, condition: 'empty' }],
      allowReconciliation: true,
      reconciliationReason: 'Physical count found one unrecorded cylinder',
    })
    expect(getCustomer(ctx, customer.id).balances.find((item) => item.code === '10L')?.outstanding).toBe(0)
    expect(consistencyProblems(ctx.db)).toEqual([])
  })

  it('reverses a dispatch with an audited counter entry', () => {
    const { ctx, sizes, date, customer } = boot()
    const before = listSizeBalances(ctx.db).find((item) => item.code === '23L')
    const dispatch = createDispatch(ctx, {
      date,
      customerId: customer.id,
      vehicleNumber: 'MH12AB9999',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: sizes['23L'], quantity: 6, condition: 'filled' }],
    })
    const reversed = reverseDispatch(ctx, dispatch.id, 'Wrong customer selected')
    expect(reversed.reversedAt).toBeTruthy()
    expect(reversed.lines[0].quantity).toBe(6)
    const after = listSizeBalances(ctx.db).find((item) => item.code === '23L')
    expect(after?.filled).toBe(before?.filled)
    expect(getCustomer(ctx, customer.id).balances.find((item) => item.code === '23L')?.outstanding).toBe(0)
    expect(consistencyProblems(ctx.db)).toEqual([])
  })

  it('moves stock between conditions without changing ownership', () => {
    const { ctx, sizes, date } = boot()
    adjustInventory(ctx, {
      date,
      sizeId: sizes['10L'],
      fromState: 'filled',
      toState: 'damaged',
      quantity: 3,
      reason: 'Valve leak found in yard',
    })
    const size = listSizeBalances(ctx.db).find((item) => item.code === '10L')
    expect(size?.filled).toBe(37)
    expect(size?.damaged).toBe(3)
    expect(size?.owned).toBe(45)
    expect(() =>
      adjustInventory(ctx, {
        date,
        sizeId: sizes['10L'],
        fromState: 'empty',
        toState: 'lost',
        quantity: 9,
        reason: 'Too many',
      }),
    ).toThrow(/Not enough/)
  })

  it('locks opening stock after later movement', () => {
    const { ctx, sizes, date, customer } = boot()
    createDispatch(ctx, {
      date,
      customerId: customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: sizes['3L'], quantity: 1, condition: 'filled' }],
    })
    expect(() =>
      setOpeningBalances(ctx, {
        rows: [{ sizeId: sizes['3L'], filled: 1, empty: 0, damaged: 0, maintenance: 0, notes: '' }],
      }),
    ).toThrow(/locked/)
  })

  it('posts an authorized reconciliation', () => {
    const { ctx, sizes, date, customer } = boot()
    reconcileCustomer(ctx, {
      date,
      customerId: customer.id,
      sizeId: sizes['23L'],
      delta: 1,
      counterState: 'filled',
      reason: 'One filled cylinder was already at the customer',
    })
    expect(getCustomer(ctx, customer.id).totalOutstanding).toBe(3)
    const size = listSizeBalances(ctx.db).find((item) => item.code === '23L')
    expect(size?.filled).toBe(39)
    expect(size?.withCustomers).toBe(1)
    expect(consistencyProblems(ctx.db)).toEqual([])
  })

  it('does not treat percent signs as match-all search', () => {
    const { ctx } = boot()
    expect(listCustomers(ctx, { page: 1, pageSize: 10, search: '%', status: 'all' }).total).toBe(0)
    expect(globalSearch(ctx, "' OR 1=1 --")).toEqual([])
    expect(globalSearch(ctx, 'Harbour').length).toBeGreaterThan(0)
  })
})

describe('month-end snapshots', () => {
  it('is historical and idempotent', () => {
    const clock = { current: new Date(2026, 0, 18) }
    const env = tempContext(() => clock.current)
    open.push(env)
    setOpeningBalances(env.ctx, {
      rows: [{ sizeId: env.sizes['3L'], filled: 20, empty: 0, damaged: 0, maintenance: 0, notes: '' }],
    })
    const customer = createCustomer(env.ctx, {
      partyName: 'January Plant',
      contactPerson: '',
      mobile: '',
      alternateMobile: '',
      email: '',
      gstNumber: '',
      billingAddress: '',
      deliveryAddress: '',
      city: '',
      state: '',
      pinCode: '',
      status: 'active',
      notes: '',
      openingBalances: [],
    })
    createDispatch(env.ctx, {
      date: '2026-01-18',
      customerId: customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 7, condition: 'filled' }],
    })
    clock.current = new Date(2026, 1, 2)
    const first = ensureMonthEnd(env.ctx)
    expect(first.periods).toEqual(['2026-01'])
    expect(getMonthEnd(env.ctx, '2026-01').totalWithCustomers).toBe(7)
    expect(unreadCount(env.ctx)).toBe(1)
    createDispatch(env.ctx, {
      date: '2026-02-01',
      customerId: customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 2, condition: 'filled' }],
    })
    expect(getMonthEnd(env.ctx, '2026-01').totalWithCustomers).toBe(7)
    expect(ensureMonthEnd(env.ctx).periods).toEqual([])
    clock.current = new Date(2026, 2, 1)
    const second = ensureMonthEnd(env.ctx)
    expect(second.periods).toEqual(['2026-02'])
    expect(getMonthEnd(env.ctx, '2026-02').totalWithCustomers).toBe(9)
    expect(ensureMonthEnd(env.ctx).periods).toEqual([])
    expect(unreadCount(env.ctx)).toBe(2)
  })
})

describe('backup and persistence', () => {
  it('restores an earlier database file', async () => {
    const env = tempContext()
    open.push(env)
    const first = createCustomer(env.ctx, {
      partyName: 'Kept Customer',
      contactPerson: '',
      mobile: '9845000002',
      alternateMobile: '',
      email: '',
      gstNumber: '',
      billingAddress: '',
      deliveryAddress: '',
      city: '',
      state: '',
      pinCode: '',
      status: 'active',
      notes: '',
      openingBalances: [],
    })
    const backupDir = path.join(env.dir, 'backups')
    const backup = await createBackup(env.ctx, backupDir, 'manual', 'test')
    createCustomer(env.ctx, {
      partyName: 'Later Customer',
      contactPerson: '',
      mobile: '',
      alternateMobile: '',
      email: '',
      gstNumber: '',
      billingAddress: '',
      deliveryAddress: '',
      city: '',
      state: '',
      pinCode: '',
      status: 'active',
      notes: '',
      openingBalances: [],
    })
    expect(listCustomers(env.ctx, { page: 1, pageSize: 10, status: 'all' }).total).toBe(2)
    restoreFromFile(env.ctx, backup.filePath)
    const names = listCustomers(env.ctx, { page: 1, pageSize: 10, status: 'all' }).rows.map((row) => row.partyName)
    expect(names).toEqual([first.partyName])
  })

  it('keeps records after the database is closed and opened again', () => {
    const env = tempContext()
    createCustomer(env.ctx, {
      partyName: 'Persistent Party',
      contactPerson: '',
      mobile: '',
      alternateMobile: '',
      email: '',
      gstNumber: '',
      billingAddress: '',
      deliveryAddress: '',
      city: '',
      state: '',
      pinCode: '',
      status: 'active',
      notes: '',
      openingBalances: [],
    })
    const dbPath = env.ctx.path
    env.close()
    const reopened = openDatabase(dbPath)
    open.push({ close: () => closeDatabase(reopened) })
    expect(listCustomers(reopened, { page: 1, pageSize: 10, status: 'all' }).rows[0]?.partyName).toBe('Persistent Party')
  })

  it('writes excel and pdf exports', async () => {
    const { ctx } = boot()
    const report = runReport(ctx, { id: 'inventory' })
    const excel = await reportToExcel(ctx, report)
    const pdf = await reportToPdf(ctx, report)
    expect(Buffer.from(excel.subarray(0, 2)).toString()).toBe('PK')
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-')
    fs.writeFileSync(path.join(ctx.path, '..', 'inventory.pdf'), pdf)
  })
})
