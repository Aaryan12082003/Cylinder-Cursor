import { and, desc, eq, sql } from 'drizzle-orm'
import type { DispatchInput, ReturnInput } from '@shared/schemas'
import type { DispatchRow, Page, ReturnRow } from '@shared/types'
import type { AppContext, Db } from '../db/database'
import { inTx } from '../db/database'
import { cylinderSizes, customers, dispatchItems, dispatches, returnItems, returns } from '../db/schema'
import { BusinessError } from './errors'
import { postReconciliation } from './inventory'
import { clean, likePattern, nullIfEmpty } from './text'
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

function loadDispatch(db: Db, id: number): DispatchRow {
  const row = db
    .select({ dispatch: dispatches, partyName: customers.partyName })
    .from(dispatches)
    .innerJoin(customers, eq(customers.id, dispatches.customerId))
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
  return {
    id: row.dispatch.id,
    number: row.dispatch.number,
    date: row.dispatch.dispatchDate,
    customerId: row.dispatch.customerId,
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
    })),
  }
}

function loadReturn(db: Db, id: number): ReturnRow {
  const row = db
    .select({ entry: returns, partyName: customers.partyName })
    .from(returns)
    .innerJoin(customers, eq(customers.id, returns.customerId))
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
  return {
    id: row.entry.id,
    number: row.entry.number,
    date: row.entry.returnDate,
    customerId: row.entry.customerId,
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
    })),
  }
}

export function getDispatch(ctx: AppContext, id: number) {
  return loadDispatch(ctx.db, id)
}

export function getReturn(ctx: AppContext, id: number) {
  return loadReturn(ctx.db, id)
}

export function createDispatch(ctx: AppContext, input: DispatchInput): DispatchRow {
  const id = inTx(ctx, (db) => {
    assertNotFuture(input.date, ctx.now())
    assertUniqueLines(input.lines)
    const customer = requireCustomer(db, input.customerId, { forDispatch: true })
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
      db.insert(dispatchItems)
        .values({ dispatchId: created.id, sizeId: line.sizeId, quantity: line.quantity, condition: line.condition })
        .run()
      const deltas: Deltas =
        line.condition === 'filled'
          ? { filled: -line.quantity, with_customer: line.quantity }
          : { empty: -line.quantity, with_customer: line.quantity }
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
  })
  return getDispatch(ctx, id)
}

export function createReturn(ctx: AppContext, input: ReturnInput): ReturnRow {
  const id = inTx(ctx, (db) => {
    assertNotFuture(input.date, ctx.now())
    assertUniqueLines(input.lines)
    const customer = requireCustomer(db, input.customerId)
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
        challanReference: challan,
        remarks: nullIfEmpty(input.remarks, 500),
        createdBy: actor,
        createdAt,
      })
      .returning()
      .all()[0]
    if (!created) throw new BusinessError('Return could not be saved.')
    for (const line of input.lines) {
      db.insert(returnItems)
        .values({ returnId: created.id, sizeId: line.sizeId, quantity: line.quantity, condition: line.condition })
        .run()
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
  })
  return getReturn(ctx, id)
}

export function reverseDispatch(ctx: AppContext, id: number, reason: string) {
  inTx(ctx, (db) => {
    const document = loadDispatch(db, id)
    if (document.reversedAt) throw new BusinessError('This dispatch has already been reversed.')
    const { today, createdAt } = stamp(ctx.now())
    for (const line of document.lines) {
      const outstanding = getOutstanding(db, document.customerId, line.sizeId)
      if (outstanding < line.quantity) {
        throw new BusinessError(
          'This dispatch cannot be reversed because some cylinders have already been returned. Reverse those returns first, or post a reconciliation.',
        )
      }
    }
    for (const line of document.lines) {
      const deltas: Deltas =
        line.condition === 'filled'
          ? { filled: line.quantity, with_customer: -line.quantity }
          : { empty: line.quantity, with_customer: -line.quantity }
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
  })
  return getDispatch(ctx, id)
}

export function reverseReturn(ctx: AppContext, id: number, reason: string) {
  inTx(ctx, (db) => {
    const document = loadReturn(db, id)
    if (document.reversedAt) throw new BusinessError('This return has already been reversed.')
    const { today, createdAt } = stamp(ctx.now())
    for (const line of document.lines) {
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
  })
  return getReturn(ctx, id)
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
