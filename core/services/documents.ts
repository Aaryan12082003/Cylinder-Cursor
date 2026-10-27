import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DispatchInput, DispatchUpdateInput, ReturnInput, ReturnUpdateInput } from '@shared/schemas'
import type { DispatchRow, Page, ReturnRow } from '@shared/types'
import type { AppContext, Db } from '../db/database'
import { inTx } from '../db/database'
import { customerLedgerEntries, cylinderMovements, cylinders, cylinderSizes, customers, dispatchItemSerials, dispatchItems, dispatches, inventoryBalances, inventoryMovements, returnItemSerials, returnItems, returns, routes } from '../db/schema'
import { BusinessError } from './errors'
import { postReconciliation } from './inventory'
import { ensureOverdueNotifications } from './notifications'
import { clean, likePattern, nullIfEmpty } from './text'
import { requireRoute } from './routes'
import {
  actorName,
  applyInventory,
  assertConsistent,
  assertNotFuture,
  assertUniqueLines,
  getOutstanding,
  nextNumber,
  postCustomerEntry,
  requireCustomer,
  requireSize,
  stamp,
  writeAudit,
  type Deltas,
  type StateKey,
} from './stock'

type DocumentQuery = {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  customerId?: number
  from?: string
  to?: string
  sizeId?: number
}

function serialsForDispatch(db: Db, serialNumbers: string[], sizeId: number, customerId: number) {
  if (!serialNumbers.length) return []
  const normalized = serialNumbers.map((value) => value.trim().toUpperCase())
  if (new Set(normalized).size !== normalized.length) throw new BusinessError('Serial numbers must be unique within a dispatch line.')
  const found = db.select().from(cylinders).where(inArray(cylinders.serialNumber, normalized)).all()
  if (found.length !== normalized.length) throw new BusinessError('One or more serial numbers are not registered.')
  for (const cylinder of found) {
    if (cylinder.sizeId !== sizeId) throw new BusinessError(`Serial ${cylinder.serialNumber} belongs to a different cylinder size.`)
    if (cylinder.status !== 'available' || cylinder.customerId !== null) throw new BusinessError(`Serial ${cylinder.serialNumber} is not available for dispatch.`)
  }
  return found
}

function serialsForReturn(db: Db, serialNumbers: string[], sizeId: number, customerId: number) {
  if (!serialNumbers.length) return []
  const normalized = serialNumbers.map((value) => value.trim().toUpperCase())
  if (new Set(normalized).size !== normalized.length) throw new BusinessError('Serial numbers must be unique within a return line.')
  const found = db.select().from(cylinders).where(inArray(cylinders.serialNumber, normalized)).all()
  if (found.length !== normalized.length) throw new BusinessError('One or more serial numbers are not registered.')
  for (const cylinder of found) {
    if (cylinder.sizeId !== sizeId) throw new BusinessError(`Serial ${cylinder.serialNumber} belongs to a different cylinder size.`)
    if (cylinder.status !== 'with_customer' || cylinder.customerId !== customerId) throw new BusinessError(`Serial ${cylinder.serialNumber} is not currently held by this customer.`)
  }
  return found
}

function hasLaterCustomerMovement(db: Db, customerId: number, sizeId: number, documentDate: string, documentNumber: string, documentCreatedAt?: string) {
  const entries = db
    .select({ id: customerLedgerEntries.id, transactionId: customerLedgerEntries.transactionId, entryDate: customerLedgerEntries.entryDate, createdAt: customerLedgerEntries.createdAt })
    .from(customerLedgerEntries)
    .where(and(eq(customerLedgerEntries.customerId, customerId), eq(customerLedgerEntries.sizeId, sizeId)))
    .all()
  const originalIds = db
    .select({ id: customerLedgerEntries.id })
    .from(customerLedgerEntries)
    .where(and(
      eq(customerLedgerEntries.customerId, customerId),
      eq(customerLedgerEntries.sizeId, sizeId),
      eq(customerLedgerEntries.transactionId, documentNumber),
    ))
    .all()
    .map((entry) => entry.id)
  if (originalIds.length) {
    const lastOriginalId = Math.max(...originalIds)
    const originalDate = entries.find((entry) => entry.transactionId === documentNumber)?.entryDate ?? documentDate
    return entries.some((entry) => entry.transactionId !== documentNumber && (entry.entryDate > originalDate || (entry.entryDate === originalDate && entry.id > lastOriginalId)))
  }
  return entries.some((entry) => entry.transactionId !== documentNumber && (entry.entryDate > documentDate || (entry.entryDate === documentDate && documentCreatedAt !== undefined && entry.createdAt >= documentCreatedAt)))
}

function normalizeDispatchAvailability(db: Db, sizeId: number, quantity: number, condition: 'filled' | 'empty'): Deltas {
  const balance = db.select().from(inventoryBalances).where(eq(inventoryBalances.sizeId, sizeId)).get()
  const available = (balance?.filledAvailable ?? 0) + (balance?.emptyAvailable ?? 0)
  if (!balance || available < quantity) throw new BusinessError(`Not enough available cylinders. Available ${available}, requested ${quantity}.`)
  const preferred = condition === 'filled' ? balance.filledAvailable : balance.emptyAvailable
  const preferredState = condition === 'filled' ? 'filled' : 'empty'
  const fallbackState = condition === 'filled' ? 'empty' : 'filled'
  const preferredQuantity = Math.min(quantity, preferred)
  const fallbackQuantity = quantity - preferredQuantity
  return {
    [preferredState]: -preferredQuantity,
    [fallbackState]: -fallbackQuantity,
  } as Deltas
}

function loadDispatch(db: Db, id: number): DispatchRow {
  const row = db
    .select({ dispatch: dispatches, partyName: customers.partyName, routeName: routes.name })
    .from(dispatches)
    .innerJoin(customers, eq(customers.id, dispatches.customerId))
    .leftJoin(routes, eq(routes.id, dispatches.routeId))
    .where(eq(dispatches.id, id))
    .get()
  if (!row) throw new BusinessError('Dispatch not found.')
  const items = db
    .select({ item: dispatchItems, sizeName: cylinderSizes.name, sizeCode: cylinderSizes.code, sortOrder: cylinderSizes.sortOrder })
    .from(dispatchItems)
    .innerJoin(cylinderSizes, eq(cylinderSizes.id, dispatchItems.sizeId))
    .where(eq(dispatchItems.dispatchId, id))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.item.condition.localeCompare(b.item.condition))
  const serialRows = db.select({ itemId: dispatchItemSerials.dispatchItemId, serialNumber: cylinders.serialNumber })
    .from(dispatchItemSerials).innerJoin(cylinders, eq(cylinders.id, dispatchItemSerials.cylinderId)).all()
  const serialMap = new Map<number, string[]>()
  for (const row of serialRows) serialMap.set(row.itemId, [...(serialMap.get(row.itemId) ?? []), row.serialNumber])
  return {
    id: row.dispatch.id,
    number: row.dispatch.number,
    date: row.dispatch.dispatchDate,
    customerId: row.dispatch.customerId,
    routeId: row.dispatch.routeId ?? null,
    routeName: row.dispatch.routeName ?? row.routeName ?? '',
    partyName: row.partyName,
    vehicleNumber: row.dispatch.vehicleNumber ?? '',
    challanNumber: row.dispatch.challanNumber ?? '',
    driverName: row.dispatch.driverName ?? '',
    remarks: row.dispatch.remarks ?? '',
    createdBy: row.dispatch.createdBy,
    createdAt: row.dispatch.createdAt,
    reversedAt: row.dispatch.reversedAt,
    reversalReason: row.dispatch.reversalReason ?? '',
    totalQuantity: items.reduce((sum, item) => sum + item.item.quantity, 0),
    lines: items.map((item) => ({
      sizeId: item.item.sizeId,
      sizeName: item.sizeName,
      sizeCode: item.sizeCode,
      quantity: item.item.quantity,
      condition: item.item.condition,
      serialNumbers: serialMap.get(item.item.id) ?? [],
    })),
  }
}

function loadReturn(db: Db, id: number): ReturnRow {
  const row = db
    .select({ entry: returns, partyName: customers.partyName, routeName: routes.name })
    .from(returns)
    .innerJoin(customers, eq(customers.id, returns.customerId))
    .leftJoin(routes, eq(routes.id, returns.routeId))
    .where(eq(returns.id, id))
    .get()
  if (!row) throw new BusinessError('Return not found.')
  const items = db
    .select({ item: returnItems, sizeName: cylinderSizes.name, sizeCode: cylinderSizes.code, sortOrder: cylinderSizes.sortOrder })
    .from(returnItems)
    .innerJoin(cylinderSizes, eq(cylinderSizes.id, returnItems.sizeId))
    .where(eq(returnItems.returnId, id))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.item.condition.localeCompare(b.item.condition))
  const serialRows = db.select({ itemId: returnItemSerials.returnItemId, serialNumber: cylinders.serialNumber })
    .from(returnItemSerials).innerJoin(cylinders, eq(cylinders.id, returnItemSerials.cylinderId)).all()
  const serialMap = new Map<number, string[]>()
  for (const row of serialRows) serialMap.set(row.itemId, [...(serialMap.get(row.itemId) ?? []), row.serialNumber])
  return {
    id: row.entry.id,
    number: row.entry.number,
    date: row.entry.returnDate,
    customerId: row.entry.customerId,
    routeId: row.entry.routeId ?? null,
    routeName: row.entry.routeName ?? row.routeName ?? '',
    partyName: row.partyName,
    challanReference: row.entry.challanReference ?? '',
    remarks: row.entry.remarks ?? '',
    createdBy: row.entry.createdBy,
    createdAt: row.entry.createdAt,
    reversedAt: row.entry.reversedAt,
    reversalReason: row.entry.reversalReason ?? '',
    totalQuantity: items.reduce((sum, item) => sum + item.item.quantity, 0),
    lines: items.map((item) => ({
      sizeId: item.item.sizeId,
      sizeName: item.sizeName,
      sizeCode: item.sizeCode,
      quantity: item.item.quantity,
      condition: item.item.condition,
      serialNumbers: serialMap.get(item.item.id) ?? [],
    })),
  }
}

export function getDispatch(ctx: AppContext, id: number) {
  return loadDispatch(ctx.db, id)
}

export function getReturn(ctx: AppContext, id: number) {
  return loadReturn(ctx.db, id)
}

function createDispatchInDb(ctx: AppContext, db: Db, input: DispatchInput, options: { allowedInactiveRouteId?: number | null } = {}): number {
    assertNotFuture(input.date, ctx.now())
    assertUniqueLines(input.lines)
    const customer = requireCustomer(db, input.customerId, { forDispatch: true })
    const route = requireRoute(db, input.routeId, { active: input.routeId !== options.allowedInactiveRouteId })
    const { createdAt } = stamp(ctx.now())
    const actor = actorName(db)
    const number = nextNumber(db, 'dispatch', input.date, 'DSP')
    const challan = nullIfEmpty(input.challanNumber, 60)
    const created = db
      .insert(dispatches)
      .values({
        number,
        dispatchDate: input.date,
        customerId: customer.id,
        routeId: route?.id ?? null,
        routeName: route?.name ?? null,
        vehicleNumber: nullIfEmpty(input.vehicleNumber, 40),
        challanNumber: challan,
        driverName: nullIfEmpty(input.driverName, 80),
        remarks: nullIfEmpty(input.remarks, 500),
        createdBy: actor,
        createdAt,
      })
      .returning()
      .all()[0]
    if (!created) throw new BusinessError('Dispatch could not be saved.')
    for (const line of input.lines) {
      const size = requireSize(db, line.sizeId)
      const serialNumbers = line.serialNumbers ?? []
      if (serialNumbers.length && serialNumbers.length !== line.quantity) throw new BusinessError(`Provide one serial number for each ${size.name} cylinder.`)
      const serials = serialsForDispatch(db, serialNumbers, line.sizeId, customer.id)
      const item = db.insert(dispatchItems)
        .values({ dispatchId: created.id, sizeId: line.sizeId, quantity: line.quantity, condition: line.condition })
        .returning()
        .all()[0]
      if (!item) throw new BusinessError('Dispatch line could not be saved.')
      for (const cylinder of serials) {
        db.insert(dispatchItemSerials).values({ dispatchItemId: item.id, cylinderId: cylinder.id }).run()
        db.update(cylinders).set({ status: 'with_customer', customerId: customer.id, updatedAt: createdAt }).where(eq(cylinders.id, cylinder.id)).run()
        db.insert(cylinderMovements).values({ cylinderId: cylinder.id, movementDate: input.date, movementType: 'dispatch', fromStatus: cylinder.status, toStatus: 'with_customer', customerId: customer.id, referenceNumber: number, createdAt }).run()
      }
      const availabilityDeltas = normalizeDispatchAvailability(db, line.sizeId, line.quantity, line.condition)
      const deltas: Deltas = { ...availabilityDeltas, with_customer: line.quantity }
      applyInventory(db, {
        sizeId: line.sizeId,
        deltas,
        date: input.date,
        movementType: 'dispatch',
        customerId: customer.id,
        referenceNumber: number,
        remarks: nullIfEmpty(input.remarks, 500),
        createdAt,
      })
      postCustomerEntry(db, {
        customerId: customer.id,
        sizeId: line.sizeId,
        date: input.date,
        transactionType: 'dispatch',
        transactionId: number,
        referenceNumber: challan ?? number,
        dispatched: line.quantity,
        remarks: nullIfEmpty(input.remarks, 500),
        createdAt,
      })
      void size
    }
    const total = input.lines.reduce((sum, line) => sum + line.quantity, 0)
    writeAudit(db, {
      occurredAt: createdAt,
      actor,
      action: 'dispatch',
      entityType: 'dispatch',
      entityId: number,
      summary: `${number}: dispatched ${total} cylinders to ${customer.partyName}.`,
      detail: input,
    })
    assertConsistent(db)
    return created.id
}

export function createDispatch(ctx: AppContext, input: DispatchInput): DispatchRow {
  const id = inTx(ctx, (db) => createDispatchInDb(ctx, db, input))
  return getDispatch(ctx, id)
}

function createReturnInDb(ctx: AppContext, db: Db, input: ReturnInput, options: { allowedInactiveRouteId?: number | null } = {}): number {
    assertNotFuture(input.date, ctx.now())
    assertUniqueLines(input.lines)
    const customer = requireCustomer(db, input.customerId)
    const route = requireRoute(db, input.routeId, { active: input.routeId !== options.allowedInactiveRouteId })
    const { createdAt } = stamp(ctx.now())
    const actor = actorName(db)
    const totals = new Map<number, number>()
    for (const line of input.lines) {
      requireSize(db, line.sizeId)
      totals.set(line.sizeId, (totals.get(line.sizeId) ?? 0) + line.quantity)
    }
    for (const [sizeId, quantity] of totals) {
      const outstanding = getOutstanding(db, customer.id, sizeId)
      if (quantity > outstanding) {
        const size = requireSize(db, sizeId)
        if (!input.allowReconciliation) {
          throw new BusinessError(
            `${customer.partyName} has ${outstanding} ${size.name} cylinders outstanding, which is less than ${quantity}. Use authorized reconciliation to record cylinders that were not on the books.`,
          )
        }
        if (clean(input.reconciliationReason, 500).length < 5) {
          throw new BusinessError('Enter a reason of at least 5 characters for the authorized reconciliation.')
        }
        postReconciliation(db, ctx.now(), {
          date: input.date,
          customerId: customer.id,
          sizeId,
          delta: quantity - outstanding,
          counterState: 'external',
          reason: clean(input.reconciliationReason, 500),
        })
      }
    }
    const number = nextNumber(db, 'return', input.date, 'RTN')
    const challan = nullIfEmpty(input.challanReference, 60)
    const created = db
      .insert(returns)
      .values({
        number,
        returnDate: input.date,
        customerId: customer.id,
        routeId: route?.id ?? null,
        routeName: route?.name ?? null,
        challanReference: challan,
        remarks: nullIfEmpty(input.remarks, 500),
        createdBy: actor,
        createdAt,
      })
      .returning()
      .all()[0]
    if (!created) throw new BusinessError('Return could not be saved.')
    for (const line of input.lines) {
      const serialNumbers = line.serialNumbers ?? []
      if (serialNumbers.length && serialNumbers.length !== line.quantity) {
        const size = requireSize(db, line.sizeId)
        throw new BusinessError(`Provide one serial number for each ${size.name} cylinder.`)
      }
      const serials = serialsForReturn(db, serialNumbers, line.sizeId, customer.id)
      const item = db.insert(returnItems)
        .values({ returnId: created.id, sizeId: line.sizeId, quantity: line.quantity, condition: line.condition })
        .returning()
        .all()[0]
      if (!item) throw new BusinessError('Return line could not be saved.')
      for (const cylinder of serials) {
        db.insert(returnItemSerials).values({ returnItemId: item.id, cylinderId: cylinder.id }).run()
        // Filled and empty are inventory conditions, not registry lifecycle states.
        // Once returned, either condition is available for a future dispatch.
        const nextStatus = line.condition === 'filled' || line.condition === 'empty' ? 'available' : line.condition
        db.update(cylinders).set({ status: nextStatus, customerId: null, updatedAt: createdAt }).where(eq(cylinders.id, cylinder.id)).run()
        db.insert(cylinderMovements).values({ cylinderId: cylinder.id, movementDate: input.date, movementType: 'return', fromStatus: cylinder.status, toStatus: nextStatus, customerId: customer.id, referenceNumber: number, createdAt }).run()
      }
      const deltas: Deltas = { with_customer: -line.quantity, [line.condition]: line.quantity }
      applyInventory(db, {
        sizeId: line.sizeId,
        deltas,
        date: input.date,
        movementType: 'return',
        customerId: customer.id,
        referenceNumber: number,
        remarks: nullIfEmpty(input.remarks, 500),
        createdAt,
      })
      postCustomerEntry(db, {
        customerId: customer.id,
        sizeId: line.sizeId,
        date: input.date,
        transactionType: 'return',
        transactionId: number,
        referenceNumber: challan ?? number,
        returned: line.quantity,
        remarks: nullIfEmpty(input.remarks, 500),
        createdAt,
      })
    }
    const total = input.lines.reduce((sum, line) => sum + line.quantity, 0)
    writeAudit(db, {
      occurredAt: createdAt,
      actor,
      action: 'return',
      entityType: 'return',
      entityId: number,
      summary: `${number}: received ${total} cylinders from ${customer.partyName}.`,
      detail: input,
    })
    assertConsistent(db)
    return created.id
}

export function createReturn(ctx: AppContext, input: ReturnInput): ReturnRow {
  const id = inTx(ctx, (db) => createReturnInDb(ctx, db, input))
  const result = getReturn(ctx, id)
  ensureOverdueNotifications(ctx)
  return result
}

function reverseDispatchInDb(ctx: AppContext, db: Db, id: number, reason: string) {
    const document = loadDispatch(db, id)
    if (document.reversedAt) throw new BusinessError('This dispatch has already been reversed.')
    const { today, createdAt } = stamp(ctx.now())
    for (const line of document.lines) {
      if (!(line.serialNumbers ?? []).length && hasLaterCustomerMovement(db, document.customerId, line.sizeId, document.date, document.number, document.createdAt)) {
        throw new BusinessError('This dispatch cannot be undone safely because a later entry exists for the same customer and cylinder size. Undo the later entry first.')
      }
      const outstanding = getOutstanding(db, document.customerId, line.sizeId)
      if (outstanding < line.quantity) {
        throw new BusinessError(
          'This dispatch cannot be reversed because some cylinders have already been returned. Reverse those returns first, or post a reconciliation.',
        )
      }
      for (const serialNumber of line.serialNumbers ?? []) {
        const cylinder = db.select().from(cylinders).where(eq(cylinders.serialNumber, serialNumber)).get()
        if (!cylinder || cylinder.status !== 'with_customer' || cylinder.customerId !== document.customerId) {
          throw new BusinessError(`Serial ${serialNumber} has moved since this dispatch and cannot be reversed safely.`)
        }
      }
    }
    const reversedSizes = new Set<number>()
    for (const line of document.lines) {
      if (!reversedSizes.has(line.sizeId)) {
        const recorded = db.select().from(inventoryMovements)
          .where(and(
            eq(inventoryMovements.sizeId, line.sizeId),
            eq(inventoryMovements.referenceNumber, document.number),
            eq(inventoryMovements.movementType, 'dispatch'),
          ))
          .all()
        const deltas: Deltas = recorded.length
          ? {
              filled: -recorded.reduce((sum, row) => sum + row.filledDelta, 0),
              empty: -recorded.reduce((sum, row) => sum + row.emptyDelta, 0),
              with_customer: -recorded.reduce((sum, row) => sum + row.withCustomerDelta, 0),
            }
          : line.condition === 'filled'
            ? { filled: line.quantity, with_customer: -line.quantity }
            : { empty: line.quantity, with_customer: -line.quantity }
        reversedSizes.add(line.sizeId)
        applyInventory(db, {
          sizeId: line.sizeId,
          deltas,
          date: today,
          movementType: 'dispatch_reversal',
          customerId: document.customerId,
          referenceNumber: document.number,
          remarks: reason,
          createdAt,
        })
      }
      postCustomerEntry(db, {
        customerId: document.customerId,
        sizeId: line.sizeId,
        date: today,
        transactionType: 'dispatch_reversal',
        transactionId: document.number,
        referenceNumber: document.number,
        adjustment: -line.quantity,
        remarks: reason,
        createdAt,
      })
      for (const serialNumber of line.serialNumbers ?? []) {
        const cylinder = db.select().from(cylinders).where(eq(cylinders.serialNumber, serialNumber)).get()
        if (!cylinder) continue
        db.update(cylinders).set({ status: 'available', customerId: null, updatedAt: createdAt }).where(eq(cylinders.id, cylinder.id)).run()
        db.insert(cylinderMovements).values({ cylinderId: cylinder.id, movementDate: today, movementType: 'dispatch_reversal', fromStatus: cylinder.status, toStatus: 'available', customerId: document.customerId, referenceNumber: document.number, createdAt }).run()
      }
    }
    db.update(dispatches)
      .set({ reversedAt: createdAt, reversalReason: reason })
      .where(eq(dispatches.id, id))
      .run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'dispatch_reversal',
      entityType: 'dispatch',
      entityId: document.number,
      summary: `${document.number} reversed. ${reason}`,
    })
    assertConsistent(db)
}

export function reverseDispatch(ctx: AppContext, id: number, reason: string) {
  inTx(ctx, (db) => reverseDispatchInDb(ctx, db, id, reason))
  return getDispatch(ctx, id)
}

function reverseReturnInDb(ctx: AppContext, db: Db, id: number, reason: string) {
    const document = loadReturn(db, id)
    if (document.reversedAt) throw new BusinessError('This return has already been reversed.')
    const { today, createdAt } = stamp(ctx.now())
    for (const line of document.lines) {
      if (!(line.serialNumbers ?? []).length && hasLaterCustomerMovement(db, document.customerId, line.sizeId, document.date, document.number, document.createdAt)) {
        throw new BusinessError('This return cannot be undone safely because a later entry exists for the same customer and cylinder size. Undo the later entry first.')
      }
      const expectedStatus = line.condition === 'filled' || line.condition === 'empty' ? 'available' : line.condition
      for (const serialNumber of line.serialNumbers ?? []) {
        const cylinder = db.select().from(cylinders).where(eq(cylinders.serialNumber, serialNumber)).get()
        if (!cylinder || cylinder.status !== expectedStatus || cylinder.customerId !== null) {
          throw new BusinessError(`Serial ${serialNumber} has moved since this return and cannot be reversed safely.`)
        }
      }
      const deltas: Deltas = {
        with_customer: line.quantity,
        [line.condition as StateKey]: -line.quantity,
      }
      applyInventory(db, {
        sizeId: line.sizeId,
        deltas,
        date: today,
        movementType: 'return_reversal',
        customerId: document.customerId,
        referenceNumber: document.number,
        remarks: reason,
        createdAt,
      })
      postCustomerEntry(db, {
        customerId: document.customerId,
        sizeId: line.sizeId,
        date: today,
        transactionType: 'return_reversal',
        transactionId: document.number,
        referenceNumber: document.number,
        adjustment: line.quantity,
        remarks: reason,
        createdAt,
      })
      for (const serialNumber of line.serialNumbers ?? []) {
        const cylinder = db.select().from(cylinders).where(eq(cylinders.serialNumber, serialNumber)).get()
        if (!cylinder) continue
        db.update(cylinders).set({ status: 'with_customer', customerId: document.customerId, updatedAt: createdAt }).where(eq(cylinders.id, cylinder.id)).run()
        db.insert(cylinderMovements).values({ cylinderId: cylinder.id, movementDate: today, movementType: 'return_reversal', fromStatus: cylinder.status, toStatus: 'with_customer', customerId: document.customerId, referenceNumber: document.number, createdAt }).run()
      }
    }
    db.update(returns).set({ reversedAt: createdAt, reversalReason: reason }).where(eq(returns.id, id)).run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'return_reversal',
      entityType: 'return',
      entityId: document.number,
      summary: `${document.number} reversed. ${reason}`,
    })
    assertConsistent(db)
}

export function reverseReturn(ctx: AppContext, id: number, reason: string) {
  inTx(ctx, (db) => reverseReturnInDb(ctx, db, id, reason))
  return getReturn(ctx, id)
}

function assertEditTargetHasNoLaterMovement(db: Db, customerId: number, sizeId: number, original: { date: string; number: string; createdAt: string }) {
  if (hasLaterCustomerMovement(db, customerId, sizeId, original.date, original.number, original.createdAt)) {
    throw new BusinessError('This edit cannot be saved safely because a later entry exists for the same customer and cylinder size. Undo the later entry first.')
  }
}

function hasReturnReconciliation(db: Db, document: ReturnRow) {
  for (const line of document.lines) {
    const entry = db
      .select()
      .from(customerLedgerEntries)
      .where(and(
        eq(customerLedgerEntries.customerId, document.customerId),
        eq(customerLedgerEntries.sizeId, line.sizeId),
        eq(customerLedgerEntries.transactionType, 'return'),
        eq(customerLedgerEntries.transactionId, document.number),
      ))
      .get()
    if (!entry) continue
    const previous = db
      .select()
      .from(customerLedgerEntries)
      .where(and(
        eq(customerLedgerEntries.customerId, document.customerId),
        eq(customerLedgerEntries.sizeId, line.sizeId),
        sql`${customerLedgerEntries.id} < ${entry.id}`,
      ))
      .orderBy(desc(customerLedgerEntries.id))
      .get()
    if (previous?.transactionType === 'reconciliation') return true
  }
  return false
}

export function editDispatch(ctx: AppContext, id: number, input: DispatchUpdateInput): DispatchRow {
  const replacementId = inTx(ctx, (db) => {
    const original = loadDispatch(db, id)
    if (original.reversedAt) throw new BusinessError('Only a posted dispatch can be edited.')
    reverseDispatchInDb(ctx, db, id, `Edited ${original.number}; replacement posted atomically.`)
    for (const line of input.lines) {
      assertEditTargetHasNoLaterMovement(db, input.customerId, line.sizeId, original)
    }
    const replacementId = createDispatchInDb(ctx, db, input, { allowedInactiveRouteId: original.routeId })
    const replacement = loadDispatch(db, replacementId)
    writeAudit(db, {
      occurredAt: stamp(ctx.now()).createdAt,
      actor: actorName(db),
      action: 'dispatch_edit',
      entityType: 'dispatch',
      entityId: replacement.number,
      summary: `${original.number} was edited and replaced by ${replacement.number}.`,
      detail: { originalId: original.id, originalNumber: original.number, replacementId: replacement.id, replacementNumber: replacement.number, input },
    })
    return replacement.id
  })
  return getDispatch(ctx, replacementId)
}

export function editReturn(ctx: AppContext, id: number, input: ReturnUpdateInput): ReturnRow {
  const replacementId = inTx(ctx, (db) => {
    const original = loadReturn(db, id)
    if (original.reversedAt) throw new BusinessError('Only a posted return can be edited.')
    if (hasReturnReconciliation(db, original)) {
      throw new BusinessError('This return cannot be edited because it includes an authorized reconciliation. Keep it in history and post a separate corrected return instead.')
    }
    reverseReturnInDb(ctx, db, id, `Edited ${original.number}; replacement posted atomically.`)
    for (const line of input.lines) {
      assertEditTargetHasNoLaterMovement(db, input.customerId, line.sizeId, original)
    }
    const replacementId = createReturnInDb(ctx, db, input, { allowedInactiveRouteId: original.routeId })
    const replacement = loadReturn(db, replacementId)
    writeAudit(db, {
      occurredAt: stamp(ctx.now()).createdAt,
      actor: actorName(db),
      action: 'return_edit',
      entityType: 'return',
      entityId: replacement.number,
      summary: `${original.number} was edited and replaced by ${replacement.number}.`,
      detail: { originalId: original.id, originalNumber: original.number, replacementId: replacement.id, replacementNumber: replacement.number, input },
    })
    return replacement.id
  })
  const result = getReturn(ctx, replacementId)
  ensureOverdueNotifications(ctx)
  return result
}

export function listDispatches(ctx: AppContext, query: DocumentQuery): Page<DispatchRow> {
  const filters = []
  if (query.customerId) filters.push(eq(dispatches.customerId, query.customerId))
  if (query.from) filters.push(sql`${dispatches.dispatchDate} >= ${query.from}`)
  if (query.to) filters.push(sql`${dispatches.dispatchDate} <= ${query.to}`)
  if (query.sizeId) {
    filters.push(sql`exists (select 1 from dispatch_items di where di.dispatch_id = ${dispatches.id} and di.size_id = ${query.sizeId})`)
  }
  if (query.search?.trim()) {
    const pattern = likePattern(query.search)
    filters.push(sql`(
      lower(${dispatches.number}) like ${pattern} escape '\\'
      or lower(coalesce(${dispatches.challanNumber}, '')) like ${pattern} escape '\\'
      or lower(${customers.partyName}) like ${pattern} escape '\\'
      or lower(coalesce(${dispatches.vehicleNumber}, '')) like ${pattern} escape '\\'
    )`)
  }
  const where = filters.length ? and(...filters) : undefined
  const total = Number(
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(dispatches)
      .innerJoin(customers, eq(customers.id, dispatches.customerId))
      .where(where)
      .get()?.n ?? 0,
  )
  const found = ctx.db
    .select({ id: dispatches.id })
    .from(dispatches)
    .innerJoin(customers, eq(customers.id, dispatches.customerId))
    .where(where)
    .orderBy(
      query.sortBy === 'number'
        ? query.sortDir === 'asc'
          ? dispatches.number
          : desc(dispatches.number)
        : query.sortDir === 'asc'
          ? dispatches.dispatchDate
          : desc(dispatches.dispatchDate),
      desc(dispatches.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  return {
    rows: found.map((row) => loadDispatch(ctx.db, row.id)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

export function listReturns(ctx: AppContext, query: DocumentQuery): Page<ReturnRow> {
  const filters = []
  if (query.customerId) filters.push(eq(returns.customerId, query.customerId))
  if (query.from) filters.push(sql`${returns.returnDate} >= ${query.from}`)
  if (query.to) filters.push(sql`${returns.returnDate} <= ${query.to}`)
  if (query.sizeId) {
    filters.push(sql`exists (select 1 from return_items ri where ri.return_id = ${returns.id} and ri.size_id = ${query.sizeId})`)
  }
  if (query.search?.trim()) {
    const pattern = likePattern(query.search)
    filters.push(sql`(
      lower(${returns.number}) like ${pattern} escape '\\'
      or lower(coalesce(${returns.challanReference}, '')) like ${pattern} escape '\\'
      or lower(${customers.partyName}) like ${pattern} escape '\\'
    )`)
  }
  const where = filters.length ? and(...filters) : undefined
  const total = Number(
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(returns)
      .innerJoin(customers, eq(customers.id, returns.customerId))
      .where(where)
      .get()?.n ?? 0,
  )
  const found = ctx.db
    .select({ id: returns.id })
    .from(returns)
    .innerJoin(customers, eq(customers.id, returns.customerId))
    .where(where)
    .orderBy(query.sortDir === 'asc' ? returns.returnDate : desc(returns.returnDate), desc(returns.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  return {
    rows: found.map((row) => loadReturn(ctx.db, row.id)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}
