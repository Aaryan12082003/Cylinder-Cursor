import { z } from 'zod'

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')

export const pageSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(10),
  search: z.string().max(120).optional().default(''),
  sortBy: z.string().max(40).optional().default(''),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

const optionalText = (max: number) => z.string().trim().max(max).optional().default('')

const mobile = z
  .string()
  .trim()
  .max(15)
  .refine((value) => value === '' || /^[6-9]\d{9}$/.test(value), 'Enter a 10-digit Indian mobile number')

const pin = z
  .string()
  .trim()
  .max(6)
  .refine((value) => value === '' || /^[1-9]\d{5}$/.test(value), 'Enter a 6-digit PIN code')

const gst = z
  .string()
  .trim()
  .max(15)
  .refine(
    (value) => value === '' || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.toUpperCase()),
    'Enter a valid 15-character GSTIN',
  )

const email = z
  .string()
  .trim()
  .max(120)
  .refine((value) => value === '' || z.string().email().safeParse(value).success, 'Enter a valid email address')

export const customerFieldsSchema = z.object({
  partyName: z.string().trim().min(2, 'Party name is required').max(160),
  contactPerson: optionalText(120),
  mobile,
  alternateMobile: mobile,
  email,
  gstNumber: gst,
  billingAddress: optionalText(300),
  deliveryAddress: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  pinCode: pin,
  status: z.enum(['active', 'inactive']).default('active'),
  alertThresholdDays: z.number().int().min(2).max(3650).nullable().optional(),
  notes: optionalText(1000),
})

export const openingLineSchema = z.object({
  sizeId: z.number().int().positive(),
  quantity: z.number().int().min(0).max(1_000_000),
})

export const customerCreateSchema = customerFieldsSchema.extend({
  openingBalances: z.array(openingLineSchema).max(30).optional().default([]),
})

export const customerUpdateSchema = customerFieldsSchema.extend({
  id: z.number().int().positive(),
})

export const idSchema = z.object({
  id: z.number().int().positive(),
})

export const archiveSchema = z.object({
  id: z.number().int().positive(),
})

export const customerListSchema = pageSchema.extend({
  status: z.enum(['open', 'active', 'inactive', 'archived', 'all']).optional().default('open'),
  outstandingOnly: z.boolean().optional().default(false),
})

export const stockLineSchema = z.object({
  sizeId: z.number().int().positive(),
  // `available` is the simplified stock model. Legacy condition fields stay
  // optional so older backups and callers continue to parse safely.
  available: z.number().int().min(0).max(1_000_000).optional(),
  filled: z.number().int().min(0).max(1_000_000).optional().default(0),
  empty: z.number().int().min(0).max(1_000_000).optional().default(0),
  damaged: z.number().int().min(0).max(1_000_000).optional().default(0),
  maintenance: z.number().int().min(0).max(1_000_000).optional().default(0),
  notes: optionalText(300),
})

export const openingStockSchema = z.object({
  rows: z.array(stockLineSchema).min(1).max(50),
})

export const companyStates = ['filled', 'empty', 'damaged', 'lost', 'maintenance'] as const
export const adjustmentStates = [...companyStates, 'external'] as const

export const adjustmentSchema = z
  .object({
    date: dateSchema,
    sizeId: z.number().int().positive(),
    fromState: z.enum(adjustmentStates),
    toState: z.enum(adjustmentStates),
    quantity: z.number().int().positive().max(1_000_000),
    // A reason is optional for quick stock increases/decreases. The service
    // records a deterministic fallback remark when it is omitted.
    reason: optionalText(500),
  })
  .refine((value) => value.fromState !== value.toState, { message: 'Source and destination must be different' })
  .refine((value) => !(value.fromState === 'external' && value.toState === 'external'), {
    message: 'Choose a cylinder state',
  })

export const reconciliationSchema = z.object({
  date: dateSchema,
  customerId: z.number().int().positive(),
  sizeId: z.number().int().positive(),
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, 'Quantity cannot be zero'),
  counterState: z.enum(adjustmentStates),
  reason: z.string().trim().min(5, 'Enter a reason of at least 5 characters').max(500),
})

export const movementListSchema = pageSchema.extend({
  sizeId: z.number().int().positive().optional(),
  type: z.string().max(40).optional().default(''),
  from: z.string().optional().default(''),
  to: z.string().optional().default(''),
})

export const dispatchLineSchema = z.object({
  sizeId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1_000_000),
  condition: z.enum(['filled', 'empty']),
  serialNumbers: z.array(z.string().trim().min(1).max(80)).max(1000).optional(),
})

export const dispatchSchema = z.object({
  date: dateSchema,
  customerId: z.number().int().positive(),
  routeId: z.number().int().positive().nullable().optional(),
  vehicleNumber: optionalText(40),
  challanNumber: optionalText(60),
  driverName: optionalText(80),
  remarks: optionalText(500),
  lines: z.array(dispatchLineSchema).min(1, 'Add at least one cylinder line').max(20),
})

export const returnLineSchema = z.object({
  sizeId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1_000_000),
  condition: z.enum(['filled', 'empty', 'damaged', 'lost', 'maintenance']),
  serialNumbers: z.array(z.string().trim().min(1).max(80)).max(1000).optional(),
})

export const serialRegistrationSchema = z.object({
  sizeId: z.number().int().positive(),
  serialNumbers: z.array(z.string().trim().min(1).max(80)).min(1).max(1000),
})

export const serialListSchema = pageSchema.extend({
  sizeId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  status: z.enum(['available', 'with_customer', 'damaged', 'lost', 'maintenance']).optional(),
})

export const returnSchema = z.object({
  date: dateSchema,
  customerId: z.number().int().positive(),
  routeId: z.number().int().positive().nullable().optional(),
  challanReference: optionalText(60),
  remarks: optionalText(500),
  lines: z.array(returnLineSchema).min(1, 'Add at least one cylinder line').max(20),
  allowReconciliation: z.boolean().optional().default(false),
  reconciliationReason: optionalText(500),
})

export const routeCreateSchema = z.object({ name: z.string().trim().min(2).max(80) })
export const routeUpdateSchema = routeCreateSchema.extend({ id: z.number().int().positive(), isActive: z.boolean() })
export const routeDetailSchema = z.object({ routeId: z.number().int().positive(), search: z.string().trim().max(120).optional().default('') })

export const reverseSchema = z.object({
  id: z.number().int().positive(),
  reason: z.string().trim().min(5, 'Enter a reason of at least 5 characters').max(500),
})

export const documentListSchema = pageSchema.extend({
  customerId: z.number().int().positive().optional(),
  from: z.string().optional().default(''),
  to: z.string().optional().default(''),
  sizeId: z.number().int().positive().optional(),
})

export const ledgerListSchema = pageSchema.extend({
  customerId: z.number().int().positive().optional(),
  sizeId: z.number().int().positive().optional(),
  type: z.string().max(40).optional().default(''),
  from: z.string().optional().default(''),
  to: z.string().optional().default(''),
})

export const reportFilterSchema = z.object({
  id: z.string().min(1).max(40),
  from: z.string().optional().default(''),
  to: z.string().optional().default(''),
  customerId: z.number().int().positive().optional(),
  sizeId: z.number().int().positive().optional(),
  periodKey: z.string().optional().default(''),
})

export const settingsUpdateSchema = z.object({
  overdueThresholdDays: z.number().int().min(1).max(3650),
  dateFormat: z.enum(['dd MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd', 'dd MMMM yyyy']),
  currency: z.enum(['INR', 'USD', 'EUR']),
  theme: z.enum(['light', 'dark']),
  autoBackup: z.boolean(),
  backupRetention: z.number().int().min(1).max(200),
  backupDirectory: z.string().max(500),
  notifyMonthEnd: z.boolean(),
  notifyNative: z.boolean(),
  operatorName: z.string().trim().min(2).max(80),
})

export const companySchema = z.object({
  name: z.string().trim().min(2, 'Company name is required').max(160),
  address: optionalText(400),
  gstNumber: gst,
  phone: optionalText(20),
  email,
})

export const sizeCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9]+$/, 'Use letters and numbers only'),
  name: z.string().trim().min(2).max(40),
  capacityLitres: z.number().positive().max(10_000),
})

export const sizeUpdateSchema = sizeCreateSchema.extend({
  id: z.number().int().positive(),
  isActive: z.boolean(),
})

export const searchSchema = z.object({
  query: z.string().trim().max(120),
})

export const periodSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/),
})

export const notificationReadSchema = z.object({
  id: z.number().int().positive(),
})

export const restoreSchema = z.object({
  id: z.number().int().positive(),
  confirmation: z.string(),
})

export const deleteAllDataSchema = z.object({
  confirmation: z.string(),
})

export const auditListSchema = pageSchema.extend({
  search: z.string().max(120).optional().default(''),
  action: z.string().max(40).optional().default(''),
})

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>
// Keep service inputs compatible with legacy callers that omit optional serial
// lists; IPC parsing still applies the empty-array defaults.
// Keep serials optional at the TypeScript boundary as well as at runtime so
// legacy quantity-only documents remain source-compatible.
export type DispatchInput = Omit<z.input<typeof dispatchSchema>, 'lines'> & {
  lines: (Omit<z.input<typeof dispatchLineSchema>, 'serialNumbers'> & { serialNumbers?: string[] })[]
}
export type ReturnInput = Omit<z.input<typeof returnSchema>, 'lines'> & {
  lines: (Omit<z.input<typeof returnLineSchema>, 'serialNumbers'> & { serialNumbers?: string[] })[]
}
export type AdjustmentInput = z.infer<typeof adjustmentSchema>
export type ReconciliationInput = z.infer<typeof reconciliationSchema>
export type OpeningStockInput = z.infer<typeof openingStockSchema>
export type SettingsInput = z.infer<typeof settingsUpdateSchema>
export type CompanyInput = z.infer<typeof companySchema>
