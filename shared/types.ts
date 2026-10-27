export type CylinderState = 'filled' | 'empty' | 'with_customer' | 'damaged' | 'lost' | 'maintenance'

export type SizeBalance = {
  id: number
  code: string
  name: string
  capacityLitres: number
  isActive: boolean
  sortOrder: number
  filled: number
  empty: number
  withCustomers: number
  damaged: number
  lost: number
  maintenance: number
  openingFilled: number
  openingEmpty: number
  openingDamaged: number
  openingMaintenance: number
  owned: number
  available: number
  openingLocked: boolean
  hasOpening: boolean
}

export type DashboardData = {
  totals: {
    owned: number
    available: number
    withCustomers: number
    filled: number
    empty: number
    damaged: number
    lost: number
    maintenance: number
    activeCustomers: number
    customersHolding: number
    dispatchesThisMonth: number
    dispatchQtyThisMonth: number
    returnsThisMonth: number
    returnQtyThisMonth: number
    overdueCustomers: number
    overdueCylinders: number
  }
  sizes: SizeBalance[]
  monthly: { month: string; label: string; dispatched: number; returned: number }[]
  distribution: { name: string; code: string; value: number }[]
  topCustomers: { id: number; name: string; total: number }[]
  outstandingTrend: { label: string; total: number }[]
  recent: { id: number; occurredAt: string; summary: string; action: string; actor: string }[]
  hasOpening: boolean
  demoLoaded: boolean
}

export type CustomerBalance = {
  sizeId: number
  code: string
  name: string
  outstanding: number
}

export type CustomerRow = {
  id: number
  code: string
  partyName: string
  contactPerson: string
  mobile: string
  alternateMobile: string
  email: string
  gstNumber: string
  billingAddress: string
  deliveryAddress: string
  city: string
  routeId: number | null
  routeName: string
  state: string
  pinCode: string
  status: 'active' | 'inactive'
  alertThresholdDays: number | null
  notes: string
  isDemo: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  balances: CustomerBalance[]
  totalOutstanding: number
}

export type Page<T> = {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export type LedgerRow = {
  id: number
  date: string
  transactionId: string
  partyName: string
  customerId: number
  sizeId: number
  sizeName: string
  sizeCode: string
  transactionType: string
  openingBalance: number
  dispatched: number
  returned: number
  adjustment: number
  closingBalance: number
  referenceNumber: string
  remarks: string
}

export type DispatchRow = {
  id: number
  number: string
  date: string
  customerId: number
  routeId: number | null
  routeName: string
  partyName: string
  vehicleNumber: string
  challanNumber: string
  driverName: string
  remarks: string
  createdBy: string
  createdAt: string
  reversedAt: string | null
  reversalReason: string
  totalQuantity: number
  lines: { sizeId: number; sizeName: string; sizeCode: string; quantity: number; condition: string; serialNumbers?: string[] }[]
}

export type ReturnRow = {
  id: number
  number: string
  date: string
  customerId: number
  routeId: number | null
  routeName: string
  partyName: string
  challanReference: string
  remarks: string
  createdBy: string
  createdAt: string
  reversedAt: string | null
  reversalReason: string
  totalQuantity: number
  lines: { sizeId: number; sizeName: string; sizeCode: string; quantity: number; condition: string; serialNumbers?: string[] }[]
}

export type CylinderRow = {
  id: number
  serialNumber: string
  sizeId: number
  sizeName: string
  sizeCode: string
  status: 'available' | 'with_customer' | 'damaged' | 'lost' | 'maintenance'
  customerId: number | null
  customerName: string
  createdAt: string
  updatedAt: string
}

export type MovementRow = {
  id: number
  date: string
  type: string
  sizeId: number
  sizeName: string
  sizeCode: string
  customerId: number | null
  partyName: string
  referenceNumber: string
  filledDelta: number
  emptyDelta: number
  withCustomerDelta: number
  damagedDelta: number
  lostDelta: number
  maintenanceDelta: number
  remarks: string
}

export type OutstandingRow = {
  customerId: number
  code: string
  partyName: string
  mobile: string
  city: string
  status: string
  balances: CustomerBalance[]
  total: number
  lastDispatchDate: string | null
  lastReturnDate: string | null
  daysSinceMovement: number | null
  alertThresholdDays: number
  overdue: boolean
}

export type ReportColumn = {
  key: string
  label: string
  align?: 'left' | 'right'
}

export type ReportModel = {
  id: string
  title: string
  subtitle: string
  columns: ReportColumn[]
  rows: Record<string, string | number | null>[]
  summary: { label: string; value: string }[]
}

export type MonthEndItem = {
  customerId: number
  customerName: string
  mobile: string
  balances: Record<string, number>
  totalOutstanding: number
  lastDispatchDate: string | null
  lastReturnDate: string | null
  daysSinceMovement: number | null
  overdue: boolean
}

export type MonthEndReport = {
  id: number
  periodKey: string
  periodLabel: string
  asOfDate: string
  generatedAt: string
  totalWithCustomers: number
  customerCount: number
  items: MonthEndItem[]
}

export type AppNotification = {
  id: number
  kind: string
  title: string
  body: string
  payload: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

export type CompanyProfile = {
  name: string
  address: string
  gstNumber: string
  phone: string
  email: string
  logoDataUrl: string | null
}

export type AppSettings = {
  overdueThresholdDays: number
  dateFormat: string
  currency: string
  theme: 'light' | 'dark'
  autoBackup: boolean
  backupRetention: number
  backupDirectory: string
  notifyMonthEnd: boolean
  notifyNative: boolean
  operatorName: string
  installedOn: string
  demoLoaded: boolean
  company: CompanyProfile
  sizes: { id: number; code: string; name: string; capacityLitres: number; isActive: boolean; sortOrder: number }[]
  routes: { id: number; name: string; isActive: boolean; createdAt: string; updatedAt: string }[]
}

export type RouteDetail = {
  route: { id: number; name: string; isActive: boolean }
  customers?: { customerId: number; customerCode: string; customerName: string; mobile: string; city: string; status: 'active' | 'inactive' }[]
  holdings: { customerId: number; customerName: string; mobile: string; sizeName: string; serialNumbers: string[]; quantity: number }[]
  history: { id: number; type: 'dispatch' | 'return'; number: string; date: string; customerName: string; quantity: number; challan: string; reversed: boolean }[]
}

export type BackupRecord = {
  id: number
  filePath: string
  fileSize: number
  createdAt: string
  kind: string
  note: string
}

export type AuditRow = {
  id: number
  occurredAt: string
  actor: string
  action: string
  entityType: string
  entityId: string
  summary: string
}

export type SearchHit = {
  kind: 'customer' | 'dispatch' | 'return'
  id: number
  title: string
  subtitle: string
  href: string
}

export type SavedFile = {
  path: string | null
}
