import { and, desc, eq, sql } from 'drizzle-orm'
import type { AdjustmentInput, OpeningStockInput, ReconciliationInput } from '@shared/schemas'
import type { MovementRow, SizeBalance } from '@shared/types'
import type { AppContext, Db } from '../db/database'
import { inTx } from '../db/database'
import {
  cylinderSizes,
  inventoryAdjustments,
  inventoryBalances,
  inventoryMovements,
  openingBalances,
  reconciliations,
  customers,
} from '../db/schema'
import { BusinessError } from './errors'
import { nullIfEmpty } from './text'
import {
  actorName,
  applyInventory,
  assertConsistent,
  assertNotFuture,
  assertUniqueLines,
  nextNumber,
  postCustomerEntry,
  requireCustomer,
  requireSize,
  stamp,
  writeAudit,
  type Deltas,
  type StateKey,
} from './stock'

type MovementList = {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  sizeId?: number
  type?: string
  from?: string
  to?: string
}

export type { MovementList as MovementListQuery }

export function ownedOf(row: {
  filledAvailable: number
  emptyAvailable: number
  withCustomer: number
  damaged: number
  underMaintenance: number
}) {
  return row.filledAvailable + row.emptyAvailable + row.withCustomer + row.damaged + row.underMaintenance
}

export function listSizeBalances(db: Db): SizeBalance[] {
  const sizes = db.select().from(cylinderSizes).orderBy(cylinderSizes.sortOrder).all()
  const balances = db.select().from(inventoryBalances).all()
  const openings = db.select().from(openingBalances).all()
  const locks = db
    .select({
      sizeId: inventoryMovements.sizeId,
      n: sql<number>`count(*)`,
    })
    .from(inventoryMovements)
    .where(sql`${inventoryMovements.movementType} != 'opening_stock'`)
    .groupBy(inventoryMovements.sizeId)
    .all()
  return sizes.map((size) => {
    const balance = balances.find((row) => row.sizeId === size.id)
    const filled = balance?.filledAvailable ?? 0
    const empty = balance?.emptyAvailable ?? 0
    const withCustomers = balance?.withCustomer ?? 0
    const damaged = balance?.damaged ?? 0
    const lost = balance?.lost ?? 0
    const maintenance = balance?.underMaintenance ?? 0
    const opening = openings.find((row) => row.sizeId === size.id)
    return {
      id: size.id,
      code: size.code,
      name: size.name,
      capacityLitres: size.capacityLitres,
      isActive: Boolean(size.isActive),
      sortOrder: size.sortOrder,
      filled,
      empty,
      withCustomers,
      damaged,
      lost,
      maintenance,
      openingFilled: opening?.filledQuantity ?? 0,
      openingEmpty: opening?.emptyQuantity ?? 0,
      openingDamaged: opening?.damagedQuantity ?? 0,
      openingMaintenance: opening?.maintenanceQuantity ?? 0,
      owned: filled + empty + withCustomers + damaged + maintenance,
      available: filled + empty,
      openingLocked: Number(locks.find((row) => row.sizeId === size.id)?.n ?? 0) > 0,
      hasOpening: openings.some((row) => row.sizeId === size.id),
    }
  })
}

export function inventoryOverview(ctx: AppContext) {
  return { sizes: listSizeBalances(ctx.db) }
}

export function setOpeningBalances(ctx: AppContext, input: OpeningStockInput) {
  return inTx(ctx, (db) => {
    const { today, createdAt } = stamp(ctx.now())
    const actor = actorName(db)
    assertUniqueLines(input.rows.map((row) => ({ sizeId: row.sizeId, condition: 'opening' })))
    for (const row of input.rows) {
      const size = requireSize(db, row.sizeId)
      const other = db
        .select({ n: sql<number>`count(*)` })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.sizeId, row.sizeId), sql`${inventoryMovements.movementType} != 'opening_stock'`))
        .get()
      const existingOpening = db.select().from(openingBalances).where(eq(openingBalances.sizeId, row.sizeId)).get()
      const hasLaterMovements = Number(other?.n ?? 0) > 0
      if (hasLaterMovements && !existingOpening) {
        throw new BusinessError(`Opening stock for ${size.name} cannot be corrected because its recorded opening balance is missing.`)
      }
      if (hasLaterMovements && existingOpening) {
        const correctionNotes = nullIfEmpty(row.notes, 300)
        if (!correctionNotes) {
          throw new BusinessError(`Enter a reason when correcting opening stock for ${size.name}.`)
        }
        const deltas: Deltas = {
          filled: row.filled - existingOpening.filledQuantity,
          empty: row.empty - existingOpening.emptyQuantity,
          damaged: row.damaged - existingOpening.damagedQuantity,
          maintenance: row.maintenance - existingOpening.maintenanceQuantity,
        }
        applyInventory(db, {
          sizeId: row.sizeId,
          deltas,
          date: today,
          movementType: 'opening_correction',
          remarks: correctionNotes,
          createdAt,
        })
        db.update(openingBalances)
          .set({
            filledQuantity: row.filled,
            emptyQuantity: row.empty,
            damagedQuantity: row.damaged,
            maintenanceQuantity: row.maintenance,
            notes: nullIfEmpty(row.notes, 300),
            createdBy: actor,
            recordedAt: createdAt,
          })
          .where(eq(openingBalances.sizeId, row.sizeId))
          .run()
        writeAudit(db, {
          occurredAt: createdAt,
          actor,
          action: 'opening_correction',
          entityType: 'cylinder_size',
          entityId: String(row.sizeId),
          summary: `Opening stock corrected for ${size.name}: ${row.filled} filled, ${row.empty} empty, ${row.damaged} damaged, ${row.maintenance} under maintenance.`,
          detail: {
            previous: {
              filled: existingOpening.filledQuantity,
              empty: existingOpening.emptyQuantity,
              damaged: existingOpening.damagedQuantity,
              maintenance: existingOpening.maintenanceQuantity,
            },
            next: {
              filled: row.filled,
              empty: row.empty,
              damaged: row.damaged,
              maintenance: row.maintenance,
            },
            deltas,
            reason: correctionNotes,
          },
        })
        continue
      }
      db.delete(inventoryMovements)
        .where(and(eq(inventoryMovements.sizeId, row.sizeId), eq(inventoryMovements.movementType, 'opening_stock')))
        .run()
      db.delete(openingBalances).where(eq(openingBalances.sizeId, row.sizeId)).run()
      const existing = db.select().from(inventoryBalances).where(eq(inventoryBalances.sizeId, row.sizeId)).get()
      if (!existing) {
        db.insert(inventoryBalances).values({ sizeId: row.sizeId, updatedAt: createdAt }).run()
      }
      db.update(inventoryBalances)
        .set({
          filledAvailable: row.filled,
          emptyAvailable: row.empty,
          damaged: row.damaged,
          underMaintenance: row.maintenance,
          withCustomer: 0,
          lost: 0,
          updatedAt: createdAt,
        })
        .where(eq(inventoryBalances.sizeId, row.sizeId))
        .run()
      db.insert(openingBalances)
        .values({
          sizeId: row.sizeId,
          filledQuantity: row.filled,
          emptyQuantity: row.empty,
          damagedQuantity: row.damaged,
          maintenanceQuantity: row.maintenance,
          notes: nullIfEmpty(row.notes, 300),
          createdBy: actor,
          recordedAt: createdAt,
        })
        .run()
      db.insert(inventoryMovements)
        .values({
          sizeId: row.sizeId,
          movementDate: today,
          movementType: 'opening_stock',
          filledDelta: row.filled,
          emptyDelta: row.empty,
          withCustomerDelta: 0,
          damagedDelta: row.damaged,
          lostDelta: 0,
          maintenanceDelta: row.maintenance,
          remarks: nullIfEmpty(row.notes, 300),
          createdAt,
        })
        .run()
      writeAudit(db, {
        occurredAt: createdAt,
        actor,
        action: 'opening_stock',
        entityType: 'cylinder_size',
        entityId: String(row.sizeId),
        summary: `Opening stock set for ${size.name}: ${row.filled} filled, ${row.empty} empty, ${row.damaged} damaged, ${row.maintenance} under maintenance.`,
      })
    }
    assertConsistent(db)
    return { sizes: listSizeBalances(db) }
  })
}

export function adjustInventory(ctx: AppContext, input: AdjustmentInput) {
  return inTx(ctx, (db) => {
    assertNotFuture(input.date, ctx.now())
    const size = requireSize(db, input.sizeId)
    const { createdAt } = stamp(ctx.now())
    const actor = actorName(db)
    const number = nextNumber(db, 'adjustment', input.date, 'ADJ')
    const reason = input.reason?.trim() ||
      (input.fromState === 'external' && input.toState !== 'external'
        ? 'Manual stock increase'
        : input.toState === 'external' && input.fromState !== 'external'
          ? 'Manual stock decrease'
          : 'Manual stock adjustment')
    const deltas: Deltas = {}
    if (input.fromState !== 'external') deltas[input.fromState as StateKey] = -input.quantity
    if (input.toState !== 'external') {
      const key = input.toState as StateKey
      deltas[key] = (deltas[key] ?? 0) + input.quantity
    }
    applyInventory(db, {
      sizeId: input.sizeId,
      deltas,
      date: input.date,
      movementType: 'adjustment',
      referenceNumber: number,
      remarks: reason,
      createdAt,
    })
    db.insert(inventoryAdjustments)
      .values({
        number,
        adjustmentDate: input.date,
        sizeId: input.sizeId,
        fromState: input.fromState,
        toState: input.toState,
        quantity: input.quantity,
        reason,
        createdBy: actor,
        createdAt,
      })
      .run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor,
      action: 'adjustment',
      entityType: 'inventory_adjustment',
      entityId: number,
      summary: `${number}: moved ${input.quantity} ${size.name} from ${input.fromState.replaceAll('_', ' ')} to ${input.toState.replaceAll('_', ' ')}.`,
      detail: { ...input, reason },
    })
    assertConsistent(db)
    return { number }
  })
}

export function postReconciliation(db: Db, now: Date, input: ReconciliationInput) {
  assertNotFuture(input.date, now)
  const customer = requireCustomer(db, input.customerId)
  const size = requireSize(db, input.sizeId)
  if (input.delta < 0 && input.counterState === 'external') {
    throw new BusinessError('Choose the stock state that receives these cylinders, or mark them lost.')
  }
  const { createdAt } = stamp(now)
  const actor = actorName(db)
  const number = nextNumber(db, 'reconciliation', input.date, 'REC')
  const deltas: Deltas = { with_customer: input.delta }
  if (input.counterState !== 'external') {
    const key = input.counterState as StateKey
    deltas[key] = (deltas[key] ?? 0) - input.delta
  }
  applyInventory(db, {
    sizeId: input.sizeId,
    deltas,
    date: input.date,
    movementType: 'reconciliation',
    customerId: input.customerId,
    referenceNumber: number,
    remarks: input.reason,
    createdAt,
  })
  postCustomerEntry(db, {
    customerId: input.customerId,
    sizeId: input.sizeId,
    date: input.date,
    transactionType: 'reconciliation',
    transactionId: number,
    referenceNumber: number,
    adjustment: input.delta,
    remarks: input.reason,
    createdAt,
  })
  db.insert(reconciliations)
    .values({
      number,
      reconciliationDate: input.date,
      customerId: input.customerId,
      sizeId: input.sizeId,
      quantityDelta: input.delta,
      counterState: input.counterState,
      reason: input.reason,
      createdBy: actor,
      createdAt,
    })
    .run()
  const direction = input.delta > 0 ? 'increased' : 'reduced'
  writeAudit(db, {
    occurredAt: createdAt,
    actor,
    action: 'reconciliation',
    entityType: 'reconciliation',
    entityId: number,
    summary: `${number}: ${customer.partyName} ${size.name} outstanding ${direction} by ${Math.abs(input.delta)}.`,
    detail: input,
  })
  return { number }
}

export function reconcileCustomer(ctx: AppContext, input: ReconciliationInput) {
  return inTx(ctx, (db) => {
    const result = postReconciliation(db, ctx.now(), input)
    assertConsistent(db)
    return result
  })
}

export function listMovements(ctx: AppContext, query: MovementList): { rows: MovementRow[]; total: number; page: number; pageSize: number } {
  const db = ctx.db
  const filters = []
  if (query.sizeId) filters.push(eq(inventoryMovements.sizeId, query.sizeId))
  if (query.type) filters.push(eq(inventoryMovements.movementType, query.type))
  if (query.from) filters.push(sql`${inventoryMovements.movementDate} >= ${query.from}`)
  if (query.to) filters.push(sql`${inventoryMovements.movementDate} <= ${query.to}`)
  if (query.search) {
    const pattern = `%${query.search.trim().toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    filters.push(sql`(
      lower(coalesce(${inventoryMovements.referenceNumber}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${inventoryMovements.remarks}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${customers.partyName}, '')) like ${pattern} escape '\\'
    )`)
  }
  const where = filters.length ? and(...filters) : undefined
  const total = Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(inventoryMovements)
      .leftJoin(customers, eq(customers.id, inventoryMovements.customerId))
      .where(where)
      .get()?.n ?? 0,
  )
  const direction = query.sortDir === 'asc' ? 'asc' : 'desc'
  const found = db
    .select({
      movement: inventoryMovements,
      sizeName: cylinderSizes.name,
      sizeCode: cylinderSizes.code,
      partyName: customers.partyName,
    })
    .from(inventoryMovements)
    .innerJoin(cylinderSizes, eq(cylinderSizes.id, inventoryMovements.sizeId))
    .leftJoin(customers, eq(customers.id, inventoryMovements.customerId))
    .where(where)
    .orderBy(direction === 'asc' ? inventoryMovements.id : desc(inventoryMovements.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  return {
    rows: found.map((row) => ({
      id: row.movement.id,
      date: row.movement.movementDate,
      type: row.movement.movementType,
      sizeId: row.movement.sizeId,
      sizeName: row.sizeName,
      sizeCode: row.sizeCode,
      customerId: row.movement.customerId,
      partyName: row.partyName ?? '',
      referenceNumber: row.movement.referenceNumber ?? '',
      filledDelta: row.movement.filledDelta,
      emptyDelta: row.movement.emptyDelta,
      withCustomerDelta: row.movement.withCustomerDelta,
      damagedDelta: row.movement.damagedDelta,
      lostDelta: row.movement.lostDelta,
      maintenanceDelta: row.movement.maintenanceDelta,
      remarks: row.movement.remarks ?? '',
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}
