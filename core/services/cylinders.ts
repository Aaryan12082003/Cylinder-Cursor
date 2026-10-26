import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { CylinderRow, Page } from '@shared/types'
import type { AppContext } from '../db/database'
import { inTx } from '../db/database'
import { cylinderMovements, cylinders, cylinderSizes, customers } from '../db/schema'
import { BusinessError } from './errors'
import { actorName, requireSize, stamp, writeAudit } from './stock'

export type RegisterCylindersInput = { sizeId: number; serialNumbers: string[] }
export type CylinderListQuery = { page: number; pageSize: number; search?: string; sizeId?: number; customerId?: number; status?: string }

function normalizeSerial(value: string) {
  return value.trim().toUpperCase()
}

export function registerCylinders(ctx: AppContext, input: RegisterCylindersInput) {
  return inTx(ctx, (db) => {
    const size = requireSize(db, input.sizeId)
    const serials = input.serialNumbers.map(normalizeSerial)
    if (serials.some((serial) => !serial)) throw new BusinessError('Serial numbers cannot be empty.')
    if (new Set(serials).size !== serials.length) throw new BusinessError('Serial numbers must be unique.')
    const existing = db.select({ serialNumber: cylinders.serialNumber }).from(cylinders).where(inArray(cylinders.serialNumber, serials)).all()
    if (existing.length) throw new BusinessError(`Serial number ${existing[0]?.serialNumber} is already registered.`)
    const { createdAt } = stamp(ctx.now())
    for (const serialNumber of serials) {
      const row = db.insert(cylinders).values({ serialNumber, sizeId: size.id, status: 'available', createdAt, updatedAt: createdAt }).returning().all()[0]
      if (!row) throw new BusinessError('Cylinder serial could not be registered.')
      db.insert(cylinderMovements).values({ cylinderId: row.id, movementDate: createdAt.slice(0, 10), movementType: 'registration', toStatus: 'available', createdAt }).run()
    }
    writeAudit(db, { occurredAt: createdAt, actor: actorName(db), action: 'cylinder_register', entityType: 'cylinder', entityId: String(size.id), summary: `Registered ${serials.length} serialised ${size.name} cylinders.` })
    return { registered: serials.length }
  })
}

export function listCylinders(ctx: AppContext, query: CylinderListQuery): Page<CylinderRow> {
  const filters = []
  if (query.sizeId) filters.push(eq(cylinders.sizeId, query.sizeId))
  if (query.customerId) filters.push(eq(cylinders.customerId, query.customerId))
  if (query.status) filters.push(eq(cylinders.status, query.status))
  if (query.search?.trim()) filters.push(sql`lower(${cylinders.serialNumber}) LIKE ${`%${query.search.trim().toLowerCase()}%`}`)
  const where = filters.length ? and(...filters) : undefined
  const total = Number(ctx.db.select({ n: sql<number>`count(*)` }).from(cylinders).where(where).get()?.n ?? 0)
  const found = ctx.db.select({ cylinder: cylinders, sizeName: cylinderSizes.name, sizeCode: cylinderSizes.code, customerName: customers.partyName })
    .from(cylinders).innerJoin(cylinderSizes, eq(cylinderSizes.id, cylinders.sizeId)).leftJoin(customers, eq(customers.id, cylinders.customerId))
    .where(where).orderBy(desc(cylinders.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize).all()
  return { rows: found.map((row) => ({ id: row.cylinder.id, serialNumber: row.cylinder.serialNumber, sizeId: row.cylinder.sizeId, sizeName: row.sizeName, sizeCode: row.sizeCode, status: row.cylinder.status as CylinderRow['status'], customerId: row.cylinder.customerId, customerName: row.customerName ?? '', createdAt: row.cylinder.createdAt, updatedAt: row.cylinder.updatedAt })), total, page: query.page, pageSize: query.pageSize }
}

