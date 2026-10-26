import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { closeDatabase, openDatabase, resolveCompatibleDatabasePath } from '../core/db/database'
import { BusinessError } from '../core/services/errors'
import { createBackup, restoreFromFile } from '../core/services/backup'
import { createCustomer, deleteCustomer, getCustomer, listCustomers } from '../core/services/customers'
import { createDispatch, createReturn, reverseDispatch } from '../core/services/documents'
import { adjustInventory, listSizeBalances, reconcileCustomer, setOpeningBalances } from '../core/services/inventory'
import { ensureMonthEnd, getMonthEnd } from '../core/services/monthEnd'
import { ensureOverdueNotifications, unreadCount } from '../core/services/notifications'
import { holdingPositions } from '../core/services/ledger'
import { reportToExcel, reportToPdf } from '../core/services/exports'
import { runReport } from '../core/services/reports'
import { consistencyProblems } from '../core/services/stock'
import { globalSearch } from '../core/services/search'
import { loadDemoData, purgeDemoData } from '../core/services/demo'
import { addCylinderSize, deleteCylinderSize, updateCylinderSize } from '../core/services/settings'
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
  it('preserves an incompatible legacy database and initializes the current schema separately', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cylinderflow-legacy-'))
    const dbPath = path.join(dir, 'cylinderflow.db')
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE cylinder_sizes (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        capacity_litres REAL NOT NULL,
        sort_order INTEGER NOT NULL,
        low_stock_threshold INTEGER NOT NULL DEFAULT 10,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (id, applied_at) VALUES ('001_init', '2026-10-22T00:00:00.000Z');
      INSERT INTO cylinder_sizes (
        id, code, name, capacity_litres, sort_order, low_stock_threshold, is_active, is_system, created_at, updated_at
      ) VALUES ('legacy-3l', '3L', 'Legacy 3 Litre', 3, 1, 10, 1, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z');
    `)
    legacy.close()
    const originalBytes = fs.readFileSync(dbPath)

    const ctx = openDatabase(dbPath)
    open.push({ close: () => closeDatabase(ctx) })
    expect(ctx.path).toBe(path.join(dir, 'cylinderflow-v2.db'))
    expect(ctx.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customers'").get()).toBeTruthy()
    expect(ctx.sqlite.prepare("SELECT name FROM schema_migrations WHERE name = '001_init'").get()).toBeTruthy()
    expect(fs.readFileSync(dbPath)).toEqual(originalBytes)
    expect(resolveCompatibleDatabasePath(dbPath)).toBe(ctx.path)
  })

  it('permanently deletes customers and recalculates their balances', () => {
    const env = tempContext(() => new Date('2026-10-22T10:00:00.000Z'))
    open.push(env)
    const unused = createCustomer(env.ctx, {
      partyName: 'Unused Customer',
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
    expect(deleteCustomer(env.ctx, unused.id)).toEqual({ deleted: true })
    expect(() => getCustomer(env.ctx, unused.id)).toThrow('Customer not found')

    const used = createCustomer(env.ctx, {
      partyName: 'Used Customer',
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
      openingBalances: [{ sizeId: env.sizes['3L'], quantity: 1 }],
    })
    expect(deleteCustomer(env.ctx, used.id)).toEqual({ deleted: true })
    expect(() => getCustomer(env.ctx, used.id)).toThrow('Customer not found')
  })

  it('purges a customer after its dispatches and returns have balanced to zero', () => {
    const env = boot(() => new Date('2026-10-22T10:00:00.000Z'))
    createDispatch(env.ctx, {
      date: env.date,
      customerId: env.customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 5, condition: 'filled' }],
    })
    createReturn(env.ctx, {
      date: env.date,
      customerId: env.customer.id,
      challanReference: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 5, condition: 'filled' }],
      allowReconciliation: false,
      reconciliationReason: '',
    })
    expect(deleteCustomer(env.ctx, env.customer.id)).toEqual({ deleted: true })
    expect(consistencyProblems(env.ctx.db)).toEqual([])
  })

  it('permanently deletes cylinder sizes with their history', () => {
    const env = tempContext(() => new Date('2026-10-22T10:00:00.000Z'))
    open.push(env)
    const unused = addCylinderSize(env.ctx, { code: '47L', name: '47 Litre', capacityLitres: 47 })
    expect(updateCylinderSize(env.ctx, { id: unused.id, code: '47x', name: '47 Litre Updated', capacityLitres: 47, isActive: true })).toBe(true)
    expect(env.ctx.sqlite.prepare('SELECT code, name FROM cylinder_sizes WHERE id = ?').get(unused.id)).toMatchObject({ code: '47X', name: '47 Litre Updated' })
    expect(() => updateCylinderSize(env.ctx, { id: unused.id, code: '3l', name: 'Duplicate', capacityLitres: 47, isActive: true })).toThrow('already exists')
    const unrecorded = listSizeBalances(env.ctx.db).find((size) => size.id === unused.id)
    expect(unrecorded).toMatchObject({ hasOpening: false, openingFilled: 0, openingEmpty: 0 })
    expect(deleteCylinderSize(env.ctx, unused.id)).toEqual({ deleted: true })

    const used = addCylinderSize(env.ctx, { code: '50L', name: '50 Litre', capacityLitres: 50 })
    setOpeningBalances(env.ctx, {
      rows: [{ sizeId: used.id, filled: 2, empty: 0, damaged: 0, maintenance: 0, notes: '' }],
    })
    expect(deleteCylinderSize(env.ctx, used.id)).toEqual({ deleted: true })
    expect(deleteCylinderSize(env.ctx, env.sizes['3L'])).toEqual({ deleted: true })
  })

  it('loads and purges demonstration data without leaving records behind', () => {
    const env = tempContext(() => new Date('2026-10-22T10:00:00.000Z'))
    open.push(env)

    expect(loadDemoData(env.ctx)).toEqual({ loaded: true })
    expect((env.ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM customers WHERE is_demo = 1').get() as { n: number }).n).toBeGreaterThan(0)
    expect((env.ctx.sqlite.prepare('SELECT value FROM application_settings WHERE key = ?').get('demo_loaded') as { value: string }).value).toBe('true')
    expect(consistencyProblems(env.ctx.db)).toEqual([])

    expect(purgeDemoData(env.ctx)).toEqual({ purged: true })
    expect((env.ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number }).n).toBe(0)
    expect((env.ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM dispatches').get() as { n: number }).n).toBe(0)
    expect((env.ctx.sqlite.prepare('SELECT value FROM application_settings WHERE key = ?').get('demo_loaded') as { value: string }).value).toBe('false')
    expect(consistencyProblems(env.ctx.db)).toEqual([])
  })

  it('preserves month-end snapshots when purging demonstration data', () => {
    const env = tempContext(() => new Date('2026-10-22T10:00:00.000Z'))
    open.push(env)
    env.ctx.sqlite.prepare(`INSERT INTO month_end_snapshots (period_key, period_label, as_of_date, generated_at, total_with_customers, customer_count) VALUES (?, ?, ?, ?, ?, ?)`).run(
      '2026-09',
      'September 2026',
      '2026-09-30',
      '2026-10-01T00:00:00.000Z',
      4,
      1,
    )

    loadDemoData(env.ctx)
    purgeDemoData(env.ctx)

    expect((env.ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM month_end_snapshots').get() as { n: number }).n).toBe(1)
  })

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

  it('supports audited stock increases and decreases from outside the books', () => {
    const { ctx, sizes, date } = boot()
    const before = listSizeBalances(ctx.db).find((item) => item.code === '10L')
    expect(before?.filled).toBe(40)

    const increase = adjustInventory(ctx, {
      date,
      sizeId: sizes['10L'],
      fromState: 'external',
      toState: 'filled',
      quantity: 7,
      reason: 'Received seven cylinders from supplier',
    })
    expect(increase.number).toMatch(/^ADJ-/)
    expect(listSizeBalances(ctx.db).find((item) => item.code === '10L')?.filled).toBe(47)

    const decrease = adjustInventory(ctx, {
      date,
      sizeId: sizes['10L'],
      fromState: 'filled',
      toState: 'external',
      quantity: 2,
      reason: 'Removed two cylinders for disposal',
    })
    expect(decrease.number).toMatch(/^ADJ-/)
    expect(listSizeBalances(ctx.db).find((item) => item.code === '10L')?.filled).toBe(45)
    expect(consistencyProblems(ctx.db)).toEqual([])

    const rows = ctx.sqlite
      .prepare("SELECT filled_delta, remarks FROM inventory_movements WHERE movement_type = 'adjustment' ORDER BY id DESC LIMIT 2")
      .all() as { filled_delta: number; remarks: string }[]
    expect(rows).toEqual([
      { filled_delta: -2, remarks: 'Removed two cylinders for disposal' },
      { filled_delta: 7, remarks: 'Received seven cylinders from supplier' },
    ])
  })

  it('allows stock increases and decreases without a reason', () => {
    const { ctx, sizes, date } = boot()

    adjustInventory(ctx, {
      date,
      sizeId: sizes['10L'],
      fromState: 'external',
      toState: 'filled',
      quantity: 3,
      reason: '',
    })
    adjustInventory(ctx, {
      date,
      sizeId: sizes['10L'],
      fromState: 'filled',
      toState: 'external',
      quantity: 1,
      reason: '',
    })

    const rows = ctx.sqlite
      .prepare("SELECT remarks FROM inventory_movements WHERE movement_type = 'adjustment' ORDER BY id DESC LIMIT 2")
      .all() as { remarks: string }[]
    expect(rows).toEqual([{ remarks: 'Manual stock decrease' }, { remarks: 'Manual stock increase' }])
    expect(consistencyProblems(ctx.db)).toEqual([])
  })

  it('corrects opening stock after later movement without rewriting history', () => {
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
    setOpeningBalances(ctx, {
      rows: [{ sizeId: sizes['3L'], filled: 52, empty: 5, damaged: 0, maintenance: 0, notes: 'Opening count correction' }],
    })
    const size = listSizeBalances(ctx.db).find((item) => item.code === '3L')
    expect(size?.filled).toBe(51)
    expect(size?.openingFilled).toBe(52)
    expect(consistencyProblems(ctx.db)).toEqual([])
    const correction = ctx.sqlite
      .prepare("SELECT movement_type, filled_delta, remarks FROM inventory_movements WHERE movement_type = 'opening_correction'")
      .get() as { movement_type: string; filled_delta: number; remarks: string }
    expect(correction).toMatchObject({ movement_type: 'opening_correction', filled_delta: 2, remarks: 'Opening count correction' })
    const audit = ctx.sqlite
      .prepare("SELECT detail_json FROM audit_logs WHERE action = 'opening_correction' ORDER BY id DESC LIMIT 1")
      .get() as { detail_json: string }
    expect(JSON.parse(audit.detail_json)).toMatchObject({
      previous: { filled: 50, empty: 5, damaged: 0, maintenance: 0 },
      next: { filled: 52, empty: 5, damaged: 0, maintenance: 0 },
      deltas: { filled: 2, empty: 0, damaged: 0, maintenance: 0 },
      reason: 'Opening count correction',
    })
    expect(() =>
      setOpeningBalances(ctx, {
        rows: [{ sizeId: sizes['3L'], filled: 0, empty: 5, damaged: 0, maintenance: 0, notes: 'Attempt too low' }],
      }),
    ).toThrow(/Not enough filled available/)
    expect(() =>
      setOpeningBalances(ctx, {
        rows: [{ sizeId: sizes['3L'], filled: 52, empty: 5, damaged: 0, maintenance: 0, notes: '' }],
      }),
    ).toThrow(/reason/)
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

describe('overdue holding notifications', () => {
  it('uses a customer-specific alert period when configured', () => {
    let current = new Date('2026-10-10T09:00:00.000Z')
    const env = boot(() => current)
    env.ctx.sqlite.prepare('UPDATE customers SET alert_threshold_days = ? WHERE id = ?').run(2, env.customer.id)
    createDispatch(env.ctx, {
      date: '2026-10-10',
      customerId: env.customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 1, condition: 'filled' }],
    })
    current = new Date('2026-10-13T09:00:00.000Z')
    const row = holdingPositions(env.ctx).find((item) => item.customerId === env.customer.id)
    expect(row).toMatchObject({ alertThresholdDays: 2, overdue: true })
  })

  it('alerts per party and allows a new alert after a later dispatch', () => {
    let current = new Date('2026-10-10T09:00:00.000Z')
    const env = boot(() => current)
    env.ctx.sqlite.prepare("UPDATE application_settings SET value = '2' WHERE key = 'overdue_threshold_days'").run()
    createDispatch(env.ctx, {
      date: '2026-10-10',
      customerId: env.customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 1, condition: 'filled' }],
    })

    current = new Date('2026-10-15T09:00:00.000Z')
    const first = ensureOverdueNotifications(env.ctx)
    expect(first).toHaveLength(1)
    expect(first[0]?.title).toContain('Harbour Metals')
    expect(first[0]?.body).toContain('5 days')
    expect(ensureOverdueNotifications(env.ctx)).toEqual([])

    createReturn(env.ctx, {
      date: '2026-10-15',
      customerId: env.customer.id,
      challanReference: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 3, condition: 'filled' }],
      allowReconciliation: false,
      reconciliationReason: '',
    })
    expect(unreadCount(env.ctx)).toBe(0)

    current = new Date('2026-10-16T09:00:00.000Z')
    createDispatch(env.ctx, {
      date: '2026-10-16',
      customerId: env.customer.id,
      vehicleNumber: '',
      challanNumber: '',
      driverName: '',
      remarks: '',
      lines: [{ sizeId: env.sizes['3L'], quantity: 1, condition: 'filled' }],
    })
    current = new Date('2026-10-20T09:00:00.000Z')
    expect(ensureOverdueNotifications(env.ctx)).toHaveLength(1)
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
