import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { CustomerCreateInput, CustomerUpdateInput } from '@shared/schemas'
import type { CustomerBalance, CustomerRow, Page } from '@shared/types'
import type { AppContext, Db } from '../db/database'
import { inTx } from '../db/database'
import { customerBalances, customerOpeningBalances, customers, cylinderSizes } from '../db/schema'
import { BusinessError } from './errors'
import { clean, likePattern, nullIfEmpty } from './text'
import {
  actorName,
  applyInventory,
  assertConsistent,
  assertUniqueLines,
  getOutstanding,
  nextNumber,
  postCustomerEntry,
  requireCustomer,
  requireSize,
  stamp,
  writeAudit,
} from './stock'

export type CustomerListQuery = {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  status?: 'open' | 'active' | 'inactive' | 'archived' | 'all'
  outstandingOnly?: boolean
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

export function balancesFor(db: Db, customerIds: number[]): Map<number, CustomerBalance[]> {
  const map = new Map<number, CustomerBalance[]>()
  if (!customerIds.length) return map
  const sizes = db.select().from(cylinderSizes).orderBy(cylinderSizes.sortOrder).all()
  const rows = db.select().from(customerBalances).where(inArray(customerBalances.customerId, customerIds)).all()
  for (const id of customerIds) {
    map.set(
      id,
      sizes.map((size) => ({
        sizeId: size.id,
        code: size.code,
        name: size.name,
        outstanding: rows.find((row) => row.customerId === id && row.sizeId === size.id)?.outstanding ?? 0,
      })),
    )
  }
  return map
}

export function toCustomerRow(
  row: typeof customers.$inferSelect,
  balances: CustomerBalance[],
): CustomerRow {
  return {
    id: row.id,
    code: row.code,
    partyName: row.partyName,
    contactPerson: text(row.contactPerson),
    mobile: text(row.mobile),
    alternateMobile: text(row.alternateMobile),
    email: text(row.email),
    gstNumber: text(row.gstNumber),
    billingAddress: text(row.billingAddress),
    deliveryAddress: text(row.deliveryAddress),
    city: text(row.city),
    state: text(row.state),
    pinCode: text(row.pinCode),
    status: row.status === 'inactive' ? 'inactive' : 'active',
    notes: text(row.notes),
    isDemo: Boolean(row.isDemo),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    balances,
    totalOutstanding: balances.reduce((sum, item) => sum + item.outstanding, 0),
  }
}

function listWhere(query: CustomerListQuery) {
  const filters = []
  if (query.status === 'open' || !query.status) filters.push(sql`${customers.archivedAt} is null`)
  if (query.status === 'active') {
    filters.push(sql`${customers.archivedAt} is null`)
    filters.push(eq(customers.status, 'active'))
  }
  if (query.status === 'inactive') {
    filters.push(sql`${customers.archivedAt} is null`)
    filters.push(eq(customers.status, 'inactive'))
  }
  if (query.status === 'archived') filters.push(sql`${customers.archivedAt} is not null`)
  if (query.outstandingOnly) {
    filters.push(sql`(select coalesce(sum(outstanding), 0) from customer_balances cb where cb.customer_id = ${customers.id}) > 0`)
  }
  if (query.search?.trim()) {
    const pattern = likePattern(query.search)
    filters.push(sql`(
      lower(${customers.partyName}) like ${pattern} escape '\\'
      or lower(coalesce(${customers.contactPerson}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${customers.mobile}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${customers.alternateMobile}, '')) like ${pattern} escape '\\'
      or lower(${customers.code}) like ${pattern} escape '\\'
      or lower(coalesce(${customers.gstNumber}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${customers.city}, '')) like ${pattern} escape '\\'
    )`)
  }
  return filters.length ? and(...filters) : undefined
}

function orderBy(query: CustomerListQuery) {
  const total = sql`(select coalesce(sum(outstanding), 0) from customer_balances cb where cb.customer_id = ${customers.id})`
  const dir = query.sortDir === 'desc' ? 'desc' : 'asc'
  if (query.sortBy === 'total') return dir === 'desc' ? desc(total) : asc(total)
  if (query.sortBy === 'city') return dir === 'desc' ? desc(customers.city) : asc(customers.city)
  if (query.sortBy === 'created') return dir === 'desc' ? desc(customers.createdAt) : asc(customers.createdAt)
  if (query.sortBy === 'mobile') return dir === 'desc' ? desc(customers.mobile) : asc(customers.mobile)
  if (query.sortBy === 'code') return dir === 'desc' ? desc(customers.code) : asc(customers.code)
  return dir === 'desc' ? desc(customers.partyName) : asc(customers.partyName)
}

export function listCustomers(ctx: AppContext, query: CustomerListQuery): Page<CustomerRow> {
  const where = listWhere(query)
  const total = Number(ctx.db.select({ n: sql<number>`count(*)` }).from(customers).where(where).get()?.n ?? 0)
  const found = ctx.db
    .select()
    .from(customers)
    .where(where)
    .orderBy(orderBy(query))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  const balanceMap = balancesFor(ctx.db, found.map((row) => row.id))
  return {
    rows: found.map((row) => toCustomerRow(row, balanceMap.get(row.id) ?? [])),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

export function getCustomer(ctx: AppContext, id: number): CustomerRow {
  const row = ctx.db.select().from(customers).where(eq(customers.id, id)).get()
  if (!row) throw new BusinessError('Customer not found.')
  const balances = balancesFor(ctx.db, [id]).get(id) ?? []
  return toCustomerRow(row, balances)
}

function customerValues(input: CustomerCreateInput | CustomerUpdateInput, updatedAt: string) {
  return {
    partyName: clean(input.partyName, 160),
    contactPerson: nullIfEmpty(input.contactPerson, 120),
    mobile: nullIfEmpty(input.mobile, 15),
    alternateMobile: nullIfEmpty(input.alternateMobile, 15),
    email: nullIfEmpty(input.email, 120),
    gstNumber: input.gstNumber ? clean(input.gstNumber, 15).toUpperCase() : null,
    billingAddress: nullIfEmpty(input.billingAddress, 300),
    deliveryAddress: nullIfEmpty(input.deliveryAddress, 300),
    city: nullIfEmpty(input.city, 80),
    state: nullIfEmpty(input.state, 80),
    pinCode: nullIfEmpty(input.pinCode, 6),
    status: input.status,
    notes: nullIfEmpty(input.notes, 1000),
    updatedAt,
  }
}

export function createCustomer(ctx: AppContext, input: CustomerCreateInput): CustomerRow {
  const id = inTx(ctx, (db) => {
    const { today, createdAt } = stamp(ctx.now())
    const actor = actorName(db)
    const code = nextNumber(db, 'customer', today, 'CUST')
    const created = db
      .insert(customers)
      .values({ code, ...customerValues(input, createdAt), createdAt })
      .returning()
      .all()[0]
    if (!created) throw new BusinessError('Customer could not be saved.')
    const openings = (input.openingBalances ?? []).filter((line) => line.quantity > 0)
    assertUniqueLines(openings.map((line) => ({ sizeId: line.sizeId, condition: 'opening' })))
    for (const line of openings) {
      const size = requireSize(db, line.sizeId)
      postCustomerEntry(db, {
        customerId: created.id,
        sizeId: line.sizeId,
        date: today,
        transactionType: 'opening',
        transactionId: code,
        referenceNumber: code,
        adjustment: line.quantity,
        remarks: 'Opening cylinder balance',
        createdAt,
      })
      applyInventory(db, {
        sizeId: line.sizeId,
        deltas: { with_customer: line.quantity },
        date: today,
        movementType: 'customer_opening',
        customerId: created.id,
        referenceNumber: code,
        remarks: 'Opening cylinder balance',
        createdAt,
      })
      db.insert(customerOpeningBalances)
        .values({ customerId: created.id, sizeId: line.sizeId, quantity: line.quantity, recordedAt: createdAt })
        .run()
      writeAudit(db, {
        occurredAt: createdAt,
        actor,
        action: 'customer_opening',
        entityType: 'customer',
        entityId: String(created.id),
        summary: `Opening balance of ${line.quantity} ${size.name} recorded for ${created.partyName}.`,
      })
    }
    writeAudit(db, {
      occurredAt: createdAt,
      actor,
      action: 'customer_create',
      entityType: 'customer',
      entityId: String(created.id),
      summary: `Customer ${code} ${created.partyName} added.`,
    })
    assertConsistent(db)
    return created.id
  })
  return getCustomer(ctx, id)
}

export function updateCustomer(ctx: AppContext, input: CustomerUpdateInput): CustomerRow {
  inTx(ctx, (db) => {
    const current = requireCustomer(db, input.id)
    const { createdAt } = stamp(ctx.now())
    db.update(customers).set(customerValues(input, createdAt)).where(eq(customers.id, input.id)).run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'customer_update',
      entityType: 'customer',
      entityId: String(input.id),
      summary: `Customer ${current.code} ${clean(input.partyName, 160)} updated.`,
    })
  })
  return getCustomer(ctx, input.id)
}

export function setCustomerArchived(ctx: AppContext, id: number, archived: boolean) {
  inTx(ctx, (db) => {
    const current = requireCustomer(db, id)
    const { createdAt } = stamp(ctx.now())
    if (archived && current.archivedAt) throw new BusinessError('This customer is already archived.')
    if (!archived && !current.archivedAt) throw new BusinessError('This customer is not archived.')
    const outstanding = db
      .select({ n: sql<number>`coalesce(sum(${customerBalances.outstanding}), 0)` })
      .from(customerBalances)
      .where(eq(customerBalances.customerId, id))
      .get()
    db.update(customers)
      .set({ archivedAt: archived ? createdAt : null, updatedAt: createdAt })
      .where(eq(customers.id, id))
      .run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: archived ? 'customer_archive' : 'customer_restore',
      entityType: 'customer',
      entityId: String(id),
      summary: archived
        ? `${current.partyName} archived. Outstanding cylinders remain ${Number(outstanding?.n ?? 0)}.`
        : `${current.partyName} restored from the archive.`,
    })
  })
  return getCustomer(ctx, id)
}

export function customerOutstanding(db: Db, customerId: number, sizeId: number) {
  return getOutstanding(db, customerId, sizeId)
}
