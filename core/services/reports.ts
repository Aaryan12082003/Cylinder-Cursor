import { formatCount, formatDateOnly, periodLabel } from '@shared/dates'
import type { ReportModel } from '@shared/types'
import type { AppContext } from '../db/database'
import { rows, setting } from '../db/database'
import { BusinessError } from './errors'
import { listSizeBalances } from './inventory'
import { holdingPositions, listLedger } from './ledger'
import { getMonthEnd, listMonthEnds } from './monthEnd'
import { currencySymbol } from './text'

export const REPORT_CATALOG = [
  { id: 'inventory', title: 'Current inventory', description: 'Owned, available, and held cylinders by size and condition.' },
  { id: 'outstanding', title: 'Customer outstanding', description: 'Cylinders currently held by each customer.' },
  { id: 'stock-by-size', title: 'Stock by cylinder size', description: 'Available stock and the share held by customers.' },
  { id: 'monthly-dispatch', title: 'Dispatch report', description: 'Dispatch lines for the selected dates.' },
  { id: 'monthly-return', title: 'Return report', description: 'Return lines for the selected dates.' },
  { id: 'customer-ledger', title: 'Customer ledger', description: 'Running cylinder statement for one customer.' },
  { id: 'movement', title: 'Cylinder movement', description: 'Every inventory movement in the selected dates.' },
  { id: 'overdue', title: 'Overdue cylinders', description: 'Customers who have held cylinders beyond the threshold.' },
  { id: 'month-end', title: 'Month-end closing', description: 'The stored month-end holding snapshot.' },
  { id: 'damaged-lost', title: 'Damaged and lost', description: 'Cylinders recorded as damaged, lost, or under maintenance.' },
  { id: 'customers', title: 'Customer register', description: 'Customer master records and current outstanding balances.' },
] as const

export type ReportFilters = {
  id: string
  from?: string
  to?: string
  customerId?: number
  sizeId?: number
  periodKey?: string
}

function rangeLabel(filters: ReportFilters) {
  if (filters.from && filters.to) return `${formatDateOnly(filters.from)} to ${formatDateOnly(filters.to)}`
  if (filters.from) return `From ${formatDateOnly(filters.from)}`
  if (filters.to) return `Until ${formatDateOnly(filters.to)}`
  return 'All dates'
}

export function runReport(ctx: AppContext, filters: ReportFilters): ReportModel {
  const company = rows<{ name: string }>(ctx, `SELECT name FROM companies WHERE id = 1`)[0]?.name ?? 'CylinderFlow'
  const dateFormat = setting(ctx.db, 'date_format', 'dd MMM yyyy')
  const currency = currencySymbol(setting(ctx.db, 'currency', 'INR'))
  const subtitle = `${company} · ${currency} records · ${rangeLabel(filters)}`
  switch (filters.id) {
    case 'inventory':
      return inventoryReport(ctx, subtitle)
    case 'outstanding':
      return outstandingReport(ctx, subtitle, false)
    case 'stock-by-size':
      return stockBySizeReport(ctx, subtitle)
    case 'monthly-dispatch':
      return documentReport(ctx, subtitle, 'dispatch', filters, dateFormat)
    case 'monthly-return':
      return documentReport(ctx, subtitle, 'return', filters, dateFormat)
    case 'customer-ledger':
      return ledgerReport(ctx, subtitle, filters, dateFormat)
    case 'movement':
      return movementReport(ctx, subtitle, filters, dateFormat)
    case 'overdue':
      return outstandingReport(ctx, subtitle, true)
    case 'month-end':
      return monthEndReport(ctx, subtitle, filters, dateFormat)
    case 'damaged-lost':
      return damagedReport(ctx, subtitle)
    case 'customers':
      return customerReport(ctx, subtitle, dateFormat)
    default:
      throw new BusinessError('Unknown report.')
  }
}

function inventoryReport(ctx: AppContext, subtitle: string): ReportModel {
  const sizes = listSizeBalances(ctx.db).filter((size) => size.isActive || size.owned || size.lost)
  const rowsOut = sizes.map((size) => ({
    size: size.name,
    filled: size.filled,
    empty: size.empty,
    withCustomers: size.withCustomers,
    damaged: size.damaged,
    lost: size.lost,
    maintenance: size.maintenance,
    available: size.available,
    owned: size.owned,
  }))
  return {
    id: 'inventory',
    title: 'Current inventory',
    subtitle,
    columns: [
      { key: 'size', label: 'Cylinder size' },
      { key: 'filled', label: 'Filled', align: 'right' },
      { key: 'empty', label: 'Empty', align: 'right' },
      { key: 'withCustomers', label: 'With customers', align: 'right' },
      { key: 'damaged', label: 'Damaged', align: 'right' },
      { key: 'lost', label: 'Lost', align: 'right' },
      { key: 'maintenance', label: 'Maintenance', align: 'right' },
      { key: 'available', label: 'Available', align: 'right' },
      { key: 'owned', label: 'Owned', align: 'right' },
    ],
    rows: rowsOut,
    summary: [
      { label: 'Owned', value: formatCount(sizes.reduce((sum, size) => sum + size.owned, 0)) },
      { label: 'Available', value: formatCount(sizes.reduce((sum, size) => sum + size.available, 0)) },
      { label: 'With customers', value: formatCount(sizes.reduce((sum, size) => sum + size.withCustomers, 0)) },
    ],
  }
}

function stockBySizeReport(ctx: AppContext, subtitle: string): ReportModel {
  const sizes = listSizeBalances(ctx.db)
  return {
    id: 'stock-by-size',
    title: 'Stock by cylinder size',
    subtitle,
    columns: [
      { key: 'size', label: 'Cylinder size' },
      { key: 'owned', label: 'Owned', align: 'right' },
      { key: 'available', label: 'Available', align: 'right' },
      { key: 'withCustomers', label: 'With customers', align: 'right' },
      { key: 'share', label: 'Held by customers', align: 'right' },
    ],
    rows: sizes.map((size) => ({
      size: size.name,
      owned: size.owned,
      available: size.available,
      withCustomers: size.withCustomers,
      share: size.owned ? `${Math.round((size.withCustomers / size.owned) * 100)}%` : '0%',
    })),
    summary: [{ label: 'Sizes', value: String(sizes.length) }],
  }
}

function outstandingReport(ctx: AppContext, subtitle: string, overdueOnly: boolean): ReportModel {
  const sizes = listSizeBalances(ctx.db)
  const holdings = holdingPositions(ctx).filter((row) => (overdueOnly ? row.overdue : true))
  return {
    id: overdueOnly ? 'overdue' : 'outstanding',
    title: overdueOnly ? 'Overdue cylinders' : 'Customer outstanding',
    subtitle,
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'mobile', label: 'Mobile' },
      ...sizes.map((size) => ({ key: size.code, label: size.name, align: 'right' as const })),
      { key: 'total', label: 'Total', align: 'right' },
      { key: 'lastDispatch', label: 'Last dispatch' },
      { key: 'lastReturn', label: 'Last return' },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'overdue', label: 'Overdue' },
    ],
    rows: holdings.map((row) => {
      const record: Record<string, string | number | null> = {
        customer: row.partyName,
        mobile: row.mobile,
        total: row.total,
        lastDispatch: row.lastDispatchDate ? formatDateOnly(row.lastDispatchDate) : '—',
        lastReturn: row.lastReturnDate ? formatDateOnly(row.lastReturnDate) : '—',
        days: row.daysSinceMovement ?? '—',
        overdue: row.overdue ? 'Yes' : 'No',
      }
      for (const size of sizes) record[size.code] = row.balances.find((item) => item.code === size.code)?.outstanding ?? 0
      return record
    }),
    summary: [
      { label: 'Customers', value: String(holdings.length) },
      { label: 'Cylinders', value: formatCount(holdings.reduce((sum, row) => sum + row.total, 0)) },
    ],
  }
}

function documentReport(
  ctx: AppContext,
  subtitle: string,
  kind: 'dispatch' | 'return',
  filters: ReportFilters,
  dateFormat: string,
): ReportModel {
  const params: unknown[] = []
  const where = ['1 = 1']
  if (filters.from) {
    where.push(kind === 'dispatch' ? 'd.dispatch_date >= ?' : 'd.return_date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    where.push(kind === 'dispatch' ? 'd.dispatch_date <= ?' : 'd.return_date <= ?')
    params.push(filters.to)
  }
  if (filters.customerId) {
    where.push('d.customer_id = ?')
    params.push(filters.customerId)
  }
  if (filters.sizeId) {
    where.push('i.size_id = ?')
    params.push(filters.sizeId)
  }
  const sqlText =
    kind === 'dispatch'
      ? `SELECT d.dispatch_date AS date, d.number, c.party_name, s.name AS size, i.condition, i.quantity,
                COALESCE(d.challan_number, '') AS challan, COALESCE(d.vehicle_number, '') AS vehicle,
                COALESCE(d.driver_name, '') AS driver, COALESCE(d.remarks, '') AS remarks,
                CASE WHEN d.reversed_at IS NULL THEN 'Posted' ELSE 'Reversed' END AS status
         FROM dispatches d
         JOIN dispatch_items i ON i.dispatch_id = d.id
         JOIN customers c ON c.id = d.customer_id
         JOIN cylinder_sizes s ON s.id = i.size_id
         WHERE ${where.join(' AND ')}
         ORDER BY d.dispatch_date, d.id, s.sort_order`
      : `SELECT d.return_date AS date, d.number, c.party_name, s.name AS size, i.condition, i.quantity,
                COALESCE(d.challan_reference, '') AS challan, COALESCE(d.remarks, '') AS remarks,
                CASE WHEN d.reversed_at IS NULL THEN 'Posted' ELSE 'Reversed' END AS status
         FROM returns d
         JOIN return_items i ON i.return_id = d.id
         JOIN customers c ON c.id = d.customer_id
         JOIN cylinder_sizes s ON s.id = i.size_id
         WHERE ${where.join(' AND ')}
         ORDER BY d.return_date, d.id, s.sort_order`
  const found = rows<Record<string, string | number>>(ctx, sqlText, params)
  const columns =
    kind === 'dispatch'
      ? [
          { key: 'date', label: 'Date' },
          { key: 'number', label: 'Number' },
          { key: 'party_name', label: 'Customer' },
          { key: 'size', label: 'Size' },
          { key: 'condition', label: 'Condition' },
          { key: 'quantity', label: 'Quantity', align: 'right' as const },
          { key: 'challan', label: 'Challan' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'driver', label: 'Driver' },
          { key: 'status', label: 'Status' },
          { key: 'remarks', label: 'Remarks' },
        ]
      : [
          { key: 'date', label: 'Date' },
          { key: 'number', label: 'Number' },
          { key: 'party_name', label: 'Customer' },
          { key: 'size', label: 'Size' },
          { key: 'condition', label: 'Condition' },
          { key: 'quantity', label: 'Quantity', align: 'right' as const },
          { key: 'challan', label: 'Challan' },
          { key: 'status', label: 'Status' },
          { key: 'remarks', label: 'Remarks' },
        ]
  return {
    id: kind === 'dispatch' ? 'monthly-dispatch' : 'monthly-return',
    title: kind === 'dispatch' ? 'Dispatch report' : 'Return report',
    subtitle,
    columns,
    rows: found.map((row) => ({ ...row, date: formatDateOnly(String(row.date), dateFormat) })),
    summary: [{ label: 'Cylinders', value: formatCount(found.reduce((sum, row) => sum + Number(row.quantity), 0)) }],
  }
}

function ledgerReport(ctx: AppContext, subtitle: string, filters: ReportFilters, dateFormat: string): ReportModel {
  if (!filters.customerId) throw new BusinessError('Choose a customer for the ledger report.')
  const page = listLedger(ctx, {
    page: 1,
    pageSize: 100000,
    customerId: filters.customerId,
    sizeId: filters.sizeId,
    from: filters.from,
    to: filters.to,
    sortDir: 'asc',
  })
  return {
    id: 'customer-ledger',
    title: 'Customer ledger',
    subtitle,
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'transactionId', label: 'Transaction ID' },
      { key: 'partyName', label: 'Party name' },
      { key: 'sizeName', label: 'Cylinder size' },
      { key: 'openingBalance', label: 'Opening', align: 'right' },
      { key: 'dispatched', label: 'Dispatched', align: 'right' },
      { key: 'returned', label: 'Returned', align: 'right' },
      { key: 'adjustment', label: 'Adjustment', align: 'right' },
      { key: 'closingBalance', label: 'Closing', align: 'right' },
      { key: 'referenceNumber', label: 'Reference' },
      { key: 'remarks', label: 'Remarks' },
    ],
    rows: page.rows.map((row) => ({
      date: formatDateOnly(row.date, dateFormat),
      transactionId: row.transactionId,
      partyName: row.partyName,
      sizeName: row.sizeName,
      openingBalance: row.openingBalance,
      dispatched: row.dispatched,
      returned: row.returned,
      adjustment: row.adjustment,
      closingBalance: row.closingBalance,
      referenceNumber: row.referenceNumber,
      remarks: row.remarks,
    })),
    summary: [
      { label: 'Dispatched', value: formatCount(page.summary.dispatched) },
      { label: 'Returned', value: formatCount(page.summary.returned) },
      { label: 'Adjustments', value: formatCount(page.summary.adjustment) },
      ...(page.summary.closing === null ? [] : [{ label: 'Closing outstanding', value: formatCount(page.summary.closing) }]),
    ],
  }
}

function movementReport(ctx: AppContext, subtitle: string, filters: ReportFilters, dateFormat: string): ReportModel {
  const params: unknown[] = []
  const where = ['1 = 1']
  if (filters.from) {
    where.push('m.movement_date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    where.push('m.movement_date <= ?')
    params.push(filters.to)
  }
  if (filters.sizeId) {
    where.push('m.size_id = ?')
    params.push(filters.sizeId)
  }
  if (filters.customerId) {
    where.push('m.customer_id = ?')
    params.push(filters.customerId)
  }
  const found = rows<Record<string, string | number | null>>(
    ctx,
    `SELECT m.movement_date AS date, m.movement_type AS type, s.name AS size, COALESCE(c.party_name, '') AS party,
            COALESCE(m.reference_number, '') AS reference, m.filled_delta AS filled, m.empty_delta AS empty,
            m.with_customer_delta AS withCustomers, m.damaged_delta AS damaged, m.lost_delta AS lost,
            m.maintenance_delta AS maintenance, COALESCE(m.remarks, '') AS remarks
     FROM inventory_movements m
     JOIN cylinder_sizes s ON s.id = m.size_id
     LEFT JOIN customers c ON c.id = m.customer_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.movement_date, m.id`,
    params,
  )
  return {
    id: 'movement',
    title: 'Cylinder movement',
    subtitle,
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'type', label: 'Type' },
      { key: 'size', label: 'Size' },
      { key: 'party', label: 'Party' },
      { key: 'reference', label: 'Reference' },
      { key: 'filled', label: 'Filled', align: 'right' },
      { key: 'empty', label: 'Empty', align: 'right' },
      { key: 'withCustomers', label: 'With customers', align: 'right' },
      { key: 'damaged', label: 'Damaged', align: 'right' },
      { key: 'lost', label: 'Lost', align: 'right' },
      { key: 'maintenance', label: 'Maintenance', align: 'right' },
      { key: 'remarks', label: 'Remarks' },
    ],
    rows: found.map((row) => ({ ...row, date: formatDateOnly(String(row.date), dateFormat) })),
    summary: [{ label: 'Movements', value: String(found.length) }],
  }
}

function monthEndReport(ctx: AppContext, subtitle: string, filters: ReportFilters, dateFormat: string): ReportModel {
  const period = filters.periodKey || listMonthEnds(ctx)[0]?.periodKey
  if (!period) throw new BusinessError('No month-end report has been generated yet. It is created automatically after a month closes.')
  const report = getMonthEnd(ctx, period)
  const sizes = listSizeBalances(ctx.db)
  return {
    id: 'month-end',
    title: `${report.periodLabel} closing`,
    subtitle: `${subtitle} · As of ${formatDateOnly(report.asOfDate, dateFormat)}`,
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'mobile', label: 'Mobile' },
      ...sizes.map((size) => ({ key: size.code, label: size.name, align: 'right' as const })),
      { key: 'total', label: 'Total', align: 'right' },
      { key: 'lastDispatch', label: 'Last dispatch' },
      { key: 'lastReturn', label: 'Last return' },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'overdue', label: 'Overdue' },
    ],
    rows: report.items.map((item) => {
      const record: Record<string, string | number | null> = {
        customer: item.customerName,
        mobile: item.mobile,
        total: item.totalOutstanding,
        lastDispatch: item.lastDispatchDate ? formatDateOnly(item.lastDispatchDate, dateFormat) : '—',
        lastReturn: item.lastReturnDate ? formatDateOnly(item.lastReturnDate, dateFormat) : '—',
        days: item.daysSinceMovement ?? '—',
        overdue: item.overdue ? 'Yes' : 'No',
      }
      for (const size of sizes) record[size.code] = item.balances[size.code] ?? 0
      return record
    }),
    summary: [
      { label: 'Period', value: periodLabel(report.periodKey) },
      { label: 'Customers', value: String(report.customerCount) },
      { label: 'Cylinders held', value: formatCount(report.totalWithCustomers) },
    ],
  }
}

function damagedReport(ctx: AppContext, subtitle: string): ReportModel {
  const sizes = listSizeBalances(ctx.db)
  return {
    id: 'damaged-lost',
    title: 'Damaged and lost cylinders',
    subtitle,
    columns: [
      { key: 'size', label: 'Cylinder size' },
      { key: 'damaged', label: 'Damaged', align: 'right' },
      { key: 'lost', label: 'Lost', align: 'right' },
      { key: 'maintenance', label: 'Under maintenance', align: 'right' },
    ],
    rows: sizes.map((size) => ({
      size: size.name,
      damaged: size.damaged,
      lost: size.lost,
      maintenance: size.maintenance,
    })),
    summary: [
      { label: 'Damaged', value: formatCount(sizes.reduce((sum, size) => sum + size.damaged, 0)) },
      { label: 'Lost', value: formatCount(sizes.reduce((sum, size) => sum + size.lost, 0)) },
      { label: 'Under maintenance', value: formatCount(sizes.reduce((sum, size) => sum + size.maintenance, 0)) },
    ],
  }
}

function customerReport(ctx: AppContext, subtitle: string, dateFormat: string): ReportModel {
  const sizes = listSizeBalances(ctx.db)
  const found = rows<Record<string, string | number | null>>(
    ctx,
    `SELECT c.code, c.party_name, COALESCE(c.contact_person, '') AS contact, COALESCE(c.mobile, '') AS mobile,
            COALESCE(c.email, '') AS email, COALESCE(c.gst_number, '') AS gst, COALESCE(c.city, '') AS city,
            COALESCE(c.state, '') AS state, c.status, c.created_at,
            CASE WHEN c.archived_at IS NULL THEN 'No' ELSE 'Yes' END AS archived
     FROM customers c
     ORDER BY c.party_name COLLATE NOCASE`,
  )
  const balances = rows<{ customer_code: string; size_code: string; outstanding: number }>(
    ctx,
    `SELECT c.code AS customer_code, s.code AS size_code, b.outstanding
     FROM customer_balances b
     JOIN customers c ON c.id = b.customer_id
     JOIN cylinder_sizes s ON s.id = b.size_id`,
  )
  return {
    id: 'customers',
    title: 'Customer register',
    subtitle,
    columns: [
      { key: 'code', label: 'Customer ID' },
      { key: 'party_name', label: 'Party name' },
      { key: 'contact', label: 'Contact' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'city', label: 'City' },
      { key: 'gst', label: 'GSTIN' },
      ...sizes.map((size) => ({ key: size.code, label: size.name, align: 'right' as const })),
      { key: 'total', label: 'Total', align: 'right' },
      { key: 'status', label: 'Status' },
      { key: 'archived', label: 'Archived' },
      { key: 'created', label: 'Created' },
    ],
    rows: found.map((row) => {
      const record: Record<string, string | number | null> = {
        ...row,
        created: formatDateOnly(String(row.created_at).slice(0, 10), dateFormat),
      }
      let total = 0
      for (const size of sizes) {
        const quantity = balances
          .filter((item) => item.customer_code === row.code && item.size_code === size.code)
          .reduce((sum, item) => sum + Number(item.outstanding), 0)
        record[size.code] = quantity
        total += quantity
      }
      record.total = total
      return record
    }),
    summary: [{ label: 'Customers', value: String(found.length) }],
  }
}
