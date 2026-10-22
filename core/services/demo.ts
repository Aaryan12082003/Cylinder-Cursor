import { todayIso } from '@shared/dates'
import type { AppContext } from '../db/database'
import { one, putSetting } from '../db/database'
import { BusinessError } from './errors'
import { createCustomer } from './customers'
import { createDispatch, createReturn } from './documents'
import { adjustInventory, setOpeningBalances } from './inventory'
import { assertConsistent } from './stock'

function shiftDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return todayIso(date)
}

export function loadDemoData(ctx: AppContext) {
  const existing = Number(
    one<{ n: number }>(
      ctx,
      `SELECT (SELECT COUNT(*) FROM customers) + (SELECT COUNT(*) FROM inventory_movements) + (SELECT COUNT(*) FROM opening_balances) AS n`,
    )?.n ?? 0,
  )
  if (existing > 0) {
    throw new BusinessError('Demonstration data can only be loaded into an empty database.')
  }
  const all = ctx.sqlite.prepare(`SELECT id, code FROM cylinder_sizes`).all() as { id: number; code: string }[]
  const idOf = (code: string) => {
    const found = all.find((size) => size.code === code)
    if (!found) throw new BusinessError(`Missing cylinder size ${code}.`)
    return found.id
  }
  const today = todayIso(ctx.now())
  const earlier = shiftDays(today, -12)
  const mid = shiftDays(today, -6)
  setOpeningBalances(ctx, {
    rows: [
      { sizeId: idOf('3L'), filled: 100, empty: 0, damaged: 0, maintenance: 0, notes: 'Demonstration opening stock' },
      { sizeId: idOf('10L'), filled: 200, empty: 0, damaged: 0, maintenance: 0, notes: 'Demonstration opening stock' },
      { sizeId: idOf('23L'), filled: 300, empty: 10, damaged: 2, maintenance: 0, notes: 'Demonstration opening stock' },
    ],
  })
  const abc = createCustomer(ctx, {
    partyName: 'ABC Industries (Demo)',
    contactPerson: 'Rakesh Shah',
    mobile: '9845012345',
    alternateMobile: '',
    email: 'accounts@abc-demo.example',
    gstNumber: '',
    billingAddress: '12 Industrial Estate',
    deliveryAddress: '12 Industrial Estate',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pinCode: '380015',
    status: 'active',
    notes: 'Demonstration customer. Not a real business record.',
    openingBalances: [],
  })
  const xyz = createCustomer(ctx, {
    partyName: 'XYZ Enterprises (Demo)',
    contactPerson: 'Meera Iyer',
    mobile: '9845098765',
    alternateMobile: '',
    email: '',
    gstNumber: '',
    billingAddress: 'Plot 8, SIPCOT',
    deliveryAddress: '',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pinCode: '600032',
    status: 'active',
    notes: 'Demonstration customer. Not a real business record.',
    openingBalances: [{ sizeId: idOf('10L'), quantity: 4 }],
  })
  createDispatch(ctx, {
    date: earlier,
    customerId: abc.id,
    vehicleNumber: 'GJ01AB1234',
    challanNumber: 'DC-DEMO-1',
    driverName: 'Demo Driver',
    remarks: 'Demonstration dispatch',
    lines: [
      { sizeId: idOf('3L'), quantity: 10, condition: 'filled' },
      { sizeId: idOf('10L'), quantity: 20, condition: 'filled' },
      { sizeId: idOf('23L'), quantity: 30, condition: 'filled' },
    ],
  })
  createReturn(ctx, {
    date: mid,
    customerId: abc.id,
    challanReference: 'DC-DEMO-1',
    remarks: 'Demonstration partial return',
    lines: [
      { sizeId: idOf('3L'), quantity: 4, condition: 'empty' },
      { sizeId: idOf('10L'), quantity: 6, condition: 'empty' },
      { sizeId: idOf('23L'), quantity: 5, condition: 'filled' },
    ],
    allowReconciliation: false,
    reconciliationReason: '',
  })
  createDispatch(ctx, {
    date: today,
    customerId: xyz.id,
    vehicleNumber: '',
    challanNumber: 'DC-DEMO-2',
    driverName: '',
    remarks: 'Demonstration dispatch',
    lines: [{ sizeId: idOf('23L'), quantity: 8, condition: 'empty' }],
  })
  adjustInventory(ctx, {
    date: today,
    sizeId: idOf('23L'),
    fromState: 'filled',
    toState: 'damaged',
    quantity: 1,
    reason: 'Demonstration damage adjustment',
  })
  ctx.sqlite.exec(`
    UPDATE customers SET is_demo = 1;
    UPDATE dispatches SET is_demo = 1;
    UPDATE returns SET is_demo = 1;
    UPDATE inventory_movements SET is_demo = 1;
    UPDATE inventory_adjustments SET is_demo = 1;
    UPDATE reconciliations SET is_demo = 1;
    UPDATE opening_balances SET is_demo = 1;
    UPDATE customer_opening_balances SET is_demo = 1;
    UPDATE customer_ledger_entries SET is_demo = 1;
    UPDATE audit_logs SET is_demo = 1;
  `)
  putSetting(ctx.db, 'demo_loaded', 'true')
  assertConsistent(ctx.db)
  return { loaded: true }
}

export function purgeDemoData(ctx: AppContext) {
  const run = ctx.sqlite.transaction(() => {
    ctx.sqlite.exec(`
      DELETE FROM month_end_snapshot_items;
      DELETE FROM month_end_snapshots;
      DELETE FROM notifications WHERE kind = 'month-end' OR ifnull(dedupe_key, '') LIKE 'month-end:%';
      DELETE FROM customer_ledger_entries WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1);
      DELETE FROM customer_balances WHERE customer_id IN (SELECT id FROM customers WHERE is_demo = 1);
      DELETE FROM customer_opening_balances WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1);
      DELETE FROM dispatch_items WHERE dispatch_id IN (SELECT id FROM dispatches WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1));
      DELETE FROM dispatches WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1);
      DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1));
      DELETE FROM returns WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1);
      DELETE FROM inventory_adjustments WHERE is_demo = 1;
      DELETE FROM reconciliations WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1);
      DELETE FROM inventory_movements WHERE is_demo = 1 OR customer_id IN (SELECT id FROM customers WHERE is_demo = 1);
      DELETE FROM opening_balances WHERE is_demo = 1;
      DELETE FROM audit_logs WHERE is_demo = 1;
      DELETE FROM customers WHERE is_demo = 1;
    `)
    rebuild(ctx)
    const remaining = Number(
      (
        ctx.sqlite
          .prepare(
            `SELECT (SELECT COUNT(*) FROM customers) + (SELECT COUNT(*) FROM dispatches) + (SELECT COUNT(*) FROM returns) + (SELECT COUNT(*) FROM inventory_adjustments) AS n`,
          )
          .get() as { n: number }
      ).n,
    )
    if (remaining === 0) ctx.sqlite.exec(`DELETE FROM document_sequences`)
  })
  run()
  putSetting(ctx.db, 'demo_loaded', 'false')
  assertConsistent(ctx.db)
  return { purged: true }
}

function rebuild(ctx: AppContext) {
  const sizes = ctx.sqlite.prepare(`SELECT id FROM cylinder_sizes`).all() as { id: number }[]
  for (const size of sizes) {
    const sums = ctx.sqlite
      .prepare(
        `SELECT
           COALESCE(SUM(filled_delta), 0) AS filled,
           COALESCE(SUM(empty_delta), 0) AS empty,
           COALESCE(SUM(with_customer_delta), 0) AS with_customer,
           COALESCE(SUM(damaged_delta), 0) AS damaged,
           COALESCE(SUM(lost_delta), 0) AS lost,
           COALESCE(SUM(maintenance_delta), 0) AS maintenance
         FROM inventory_movements WHERE size_id = ?`,
      )
      .get(size.id) as {
      filled: number
      empty: number
      with_customer: number
      damaged: number
      lost: number
      maintenance: number
    }
    ctx.sqlite
      .prepare(
        `UPDATE inventory_balances
         SET filled_available = ?, empty_available = ?, with_customer = ?, damaged = ?, lost = ?, under_maintenance = ?, updated_at = ?
         WHERE size_id = ?`,
      )
      .run(sums.filled, sums.empty, sums.with_customer, sums.damaged, sums.lost, sums.maintenance, new Date().toISOString(), size.id)
  }
  ctx.sqlite.exec(`DELETE FROM customer_balances`)
  ctx.sqlite.exec(`
    INSERT INTO customer_balances (customer_id, size_id, outstanding)
    SELECT customer_id, size_id, SUM(dispatched) - SUM(returned) + SUM(adjustment)
    FROM customer_ledger_entries
    GROUP BY customer_id, size_id
    HAVING SUM(dispatched) - SUM(returned) + SUM(adjustment) >= 0
  `)
}
