import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const companies = sqliteTable('companies', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  gstNumber: text('gst_number'),
  phone: text('phone'),
  email: text('email'),
  logoPath: text('logo_path'),
  updatedAt: text('updated_at').notNull(),
})

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
})

export const cylinderSizes = sqliteTable('cylinder_sizes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  capacityLitres: real('capacity_litres').notNull(),
  sortOrder: integer('sort_order').notNull(),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
})

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  partyName: text('party_name').notNull(),
  contactPerson: text('contact_person'),
  mobile: text('mobile'),
  alternateMobile: text('alternate_mobile'),
  email: text('email'),
  gstNumber: text('gst_number'),
  billingAddress: text('billing_address'),
  deliveryAddress: text('delivery_address'),
  city: text('city'),
  state: text('state'),
  pinCode: text('pin_code'),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  isDemo: integer('is_demo').notNull().default(0),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const inventoryBalances = sqliteTable('inventory_balances', {
  sizeId: integer('size_id').primaryKey().references(() => cylinderSizes.id),
  filledAvailable: integer('filled_available').notNull().default(0),
  emptyAvailable: integer('empty_available').notNull().default(0),
  withCustomer: integer('with_customer').notNull().default(0),
  damaged: integer('damaged').notNull().default(0),
  lost: integer('lost').notNull().default(0),
  underMaintenance: integer('under_maintenance').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

export const customerBalances = sqliteTable(
  'customer_balances',
  {
    customerId: integer('customer_id').notNull().references(() => customers.id),
    sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
    outstanding: integer('outstanding').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.customerId, table.sizeId] })],
)

export const documentSequences = sqliteTable(
  'document_sequences',
  {
    name: text('name').notNull(),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.year] })],
)

export const openingBalances = sqliteTable('opening_balances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sizeId: integer('size_id').notNull().unique().references(() => cylinderSizes.id),
  filledQuantity: integer('filled_quantity').notNull().default(0),
  emptyQuantity: integer('empty_quantity').notNull().default(0),
  damagedQuantity: integer('damaged_quantity').notNull().default(0),
  maintenanceQuantity: integer('maintenance_quantity').notNull().default(0),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  recordedAt: text('recorded_at').notNull(),
  isDemo: integer('is_demo').notNull().default(0),
})

export const customerOpeningBalances = sqliteTable(
  'customer_opening_balances',
  {
    customerId: integer('customer_id').notNull().references(() => customers.id),
    sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
    quantity: integer('quantity').notNull(),
    recordedAt: text('recorded_at').notNull(),
    isDemo: integer('is_demo').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.customerId, table.sizeId] })],
)

export const dispatches = sqliteTable('dispatches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: text('number').notNull().unique(),
  dispatchDate: text('dispatch_date').notNull(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  vehicleNumber: text('vehicle_number'),
  challanNumber: text('challan_number'),
  driverName: text('driver_name'),
  remarks: text('remarks'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  reversedAt: text('reversed_at'),
  reversalReason: text('reversal_reason'),
  isDemo: integer('is_demo').notNull().default(0),
})

export const dispatchItems = sqliteTable('dispatch_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dispatchId: integer('dispatch_id').notNull().references(() => dispatches.id),
  sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
  quantity: integer('quantity').notNull(),
  condition: text('condition').notNull(),
})

export const returns = sqliteTable('returns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: text('number').notNull().unique(),
  returnDate: text('return_date').notNull(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  challanReference: text('challan_reference'),
  remarks: text('remarks'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  reversedAt: text('reversed_at'),
  reversalReason: text('reversal_reason'),
  isDemo: integer('is_demo').notNull().default(0),
})

export const returnItems = sqliteTable('return_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  returnId: integer('return_id').notNull().references(() => returns.id),
  sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
  quantity: integer('quantity').notNull(),
  condition: text('condition').notNull(),
})

export const customerLedgerEntries = sqliteTable('customer_ledger_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
  entryDate: text('entry_date').notNull(),
  transactionType: text('transaction_type').notNull(),
  transactionId: text('transaction_id').notNull(),
  referenceNumber: text('reference_number'),
  openingBalance: integer('opening_balance').notNull(),
  dispatched: integer('dispatched').notNull().default(0),
  returned: integer('returned').notNull().default(0),
  adjustment: integer('adjustment').notNull().default(0),
  closingBalance: integer('closing_balance').notNull(),
  remarks: text('remarks'),
  createdAt: text('created_at').notNull(),
  isDemo: integer('is_demo').notNull().default(0),
})

export const inventoryMovements = sqliteTable('inventory_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
  customerId: integer('customer_id').references(() => customers.id),
  movementDate: text('movement_date').notNull(),
  movementType: text('movement_type').notNull(),
  referenceNumber: text('reference_number'),
  filledDelta: integer('filled_delta').notNull().default(0),
  emptyDelta: integer('empty_delta').notNull().default(0),
  withCustomerDelta: integer('with_customer_delta').notNull().default(0),
  damagedDelta: integer('damaged_delta').notNull().default(0),
  lostDelta: integer('lost_delta').notNull().default(0),
  maintenanceDelta: integer('maintenance_delta').notNull().default(0),
  remarks: text('remarks'),
  createdAt: text('created_at').notNull(),
  isDemo: integer('is_demo').notNull().default(0),
})

export const inventoryAdjustments = sqliteTable('inventory_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: text('number').notNull().unique(),
  adjustmentDate: text('adjustment_date').notNull(),
  sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  quantity: integer('quantity').notNull(),
  reason: text('reason').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  isDemo: integer('is_demo').notNull().default(0),
})

export const reconciliations = sqliteTable('reconciliations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: text('number').notNull().unique(),
  reconciliationDate: text('reconciliation_date').notNull(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  sizeId: integer('size_id').notNull().references(() => cylinderSizes.id),
  quantityDelta: integer('quantity_delta').notNull(),
  counterState: text('counter_state').notNull(),
  reason: text('reason').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  isDemo: integer('is_demo').notNull().default(0),
})

export const monthEndSnapshots = sqliteTable('month_end_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  periodKey: text('period_key').notNull().unique(),
  periodLabel: text('period_label').notNull(),
  asOfDate: text('as_of_date').notNull(),
  generatedAt: text('generated_at').notNull(),
  totalWithCustomers: integer('total_with_customers').notNull(),
  customerCount: integer('customer_count').notNull(),
})

export const monthEndSnapshotItems = sqliteTable('month_end_snapshot_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => monthEndSnapshots.id),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  customerName: text('customer_name').notNull(),
  mobile: text('mobile'),
  balancesJson: text('balances_json').notNull(),
  totalOutstanding: integer('total_outstanding').notNull(),
  lastDispatchDate: text('last_dispatch_date'),
  lastReturnDate: text('last_return_date'),
  daysSinceMovement: integer('days_since_movement'),
  overdue: integer('overdue').notNull().default(0),
})

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  payloadJson: text('payload_json'),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull(),
  dedupeKey: text('dedupe_key').unique(),
})

export const applicationSettings = sqliteTable('application_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  occurredAt: text('occurred_at').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  summary: text('summary').notNull(),
  detailJson: text('detail_json'),
  isDemo: integer('is_demo').notNull().default(0),
})

export const backupHistory = sqliteTable('backup_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size').notNull(),
  createdAt: text('created_at').notNull(),
  kind: text('kind').notNull(),
  note: text('note'),
})
