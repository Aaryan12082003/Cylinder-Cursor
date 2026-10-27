import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { CustomerCreateInput, CustomerUpdateInput } from '@shared/schemas'
import type { CustomerBalance, CustomerRow, Page } from '@shared/types'
import type { AppContext, Db } from '../db/database'
import { inTx } from '../db/database'
import {
  customerBalances,
  customerLedgerEntries,
  customerOpeningBalances,
  customers,
  cylinderSizes,
  dispatchItems,
  dispatches,
  inventoryMovements,
  monthEndSnapshotItems,
  reconciliations,
  returns,
  routes,
} from '../db/schema'
import { BusinessError } from './errors'
import { requireRoute } from './routes'
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

/**
 * Route names are the canonical route key for new customer records. Keep the
 * comparison deliberately small and deterministic: trim outer whitespace and
 * compare case-insensitively, while retaining the route's original casing in
 * the stored relation and display value.
 */
function routeKey(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function routeForCity(db: Db, city: string | null | undefined) {
  const key = routeKey(city)
  if (!key) return null
  const matches = db
    .select()
    .from(routes)
    .where(sql`${routes.isActive} = 1 AND lower(trim(${routes.name})) = ${key}`)
    .all()
  // A legacy database can contain case-variant route names even though the
  // service now prevents them. Do not guess when more than one active route
  // matches the city.
  return matches.length === 1 ? matches[0] : null
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
  routeName = '',
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
    routeId: row.routeId ?? null,
    routeName,
    state: text(row.state),
    pinCode: text(row.pinCode),
    status: row.status === 'inactive' ? 'inactive' : 'active',
    alertThresholdDays: row.alertThresholdDays ?? null,
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
    .select({ customer: customers, routeName: routes.name })
    .from(customers)
    .leftJoin(routes, eq(routes.id, customers.routeId))
    .where(where)
    .orderBy(orderBy(query))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  const balanceMap = balancesFor(ctx.db, found.map((row) => row.customer.id))
  return {
    rows: found.map((row) => toCustomerRow(row.customer, balanceMap.get(row.customer.id) ?? [], row.routeName ?? '')),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

export function getCustomer(ctx: AppContext, id: number): CustomerRow {
  const found = ctx.db
    .select({ customer: customers, routeName: routes.name })
    .from(customers)
    .leftJoin(routes, eq(routes.id, customers.routeId))
    .where(eq(customers.id, id))
    .get()
  if (!found) throw new BusinessError('Customer not found.')
  const balances = balancesFor(ctx.db, [id]).get(id) ?? []
  return toCustomerRow(found.customer, balances, found.routeName ?? '')
}

function customerValues(input: CustomerCreateInput | CustomerUpdateInput, updatedAt: string) {
  const values = {
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
    alertThresholdDays: input.alertThresholdDays ?? null,
    notes: nullIfEmpty(input.notes, 1000),
    updatedAt,
    routeId: undefined as number | null | undefined,
  }
  if ('routeId' in input) values.routeId = input.routeId ?? null
  return values
}

export function createCustomer(ctx: AppContext, input: CustomerCreateInput): CustomerRow {
  const id = inTx(ctx, (db) => {
    const { today, createdAt } = stamp(ctx.now())
    const actor = actorName(db)
    // City is the source of truth for new assignments. Keep the explicit
    // routeId fallback for older callers/backups whose city does not map to a
    // route yet; a matching active city route always wins over that legacy
    // selection.
    const cityRoute = routeForCity(db, input.city)
    const route = cityRoute ?? requireRoute(db, input.routeId)
    const code = nextNumber(db, 'customer', today, 'CUST')
    const created = db
      .insert(customers)
      .values({ code, ...customerValues(input, createdAt), routeId: route?.id ?? null, createdAt })
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
    // Keep an existing inactive assignment stable when editing other customer
    // fields. A user may save the form with the same inactive route selected;
    // only a new assignment must point to an active route.
    if ('routeId' in input && input.routeId !== undefined && input.routeId !== current.routeId) requireRoute(db, input.routeId)
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

export function deleteCustomer(ctx: AppContext, id: number) {
  return inTx(ctx, (db) => {
    const current = requireCustomer(db, id)
    const { createdAt } = stamp(ctx.now())
    // A permanent customer delete is an explicit data purge. Return serialised
    // cylinders to available stock and remove the customer's documents and
    // balances so inventory totals do not retain an orphaned holding.
    const balances = db.select().from(customerBalances).where(eq(customerBalances.customerId, id)).all()
    for (const balance of balances) {
      if (balance.outstanding <= 0) continue
      const dispatchTotals = db
        .select({
          filled: sql<number>`coalesce(sum(case when ${dispatchItems.condition} = 'filled' then ${dispatchItems.quantity} else 0 end), 0)`,
          empty: sql<number>`coalesce(sum(case when ${dispatchItems.condition} = 'empty' then ${dispatchItems.quantity} else 0 end), 0)`,
        })
        .from(dispatchItems)
        .innerJoin(dispatches, eq(dispatches.id, dispatchItems.dispatchId))
        .where(and(eq(dispatches.customerId, id), eq(dispatchItems.sizeId, balance.sizeId)))
        .get()
      const filled = Number(dispatchTotals?.filled ?? 0)
      const empty = Number(dispatchTotals?.empty ?? 0)
      const opening = db.select({ quantity: customerOpeningBalances.quantity }).from(customerOpeningBalances)
        .where(and(eq(customerOpeningBalances.customerId, id), eq(customerOpeningBalances.sizeId, balance.sizeId))).get()
      const openingQuantity = Number(opening?.quantity ?? 0)
      if (filled === 0 && empty === 0 && openingQuantity > 0) {
        // Customer opening balances predate condition-level tracking; use the
        // normal available bucket rather than leaving stock orphaned.
        db.run(sql`UPDATE inventory_balances SET filled_available = filled_available + ${balance.outstanding}, with_customer = MAX(0, with_customer - ${balance.outstanding}), updated_at = ${createdAt} WHERE size_id = ${balance.sizeId}`)
        db.insert(inventoryMovements).values({ sizeId: balance.sizeId, customerId: null, movementDate: createdAt.slice(0, 10), movementType: 'customer_purge', referenceNumber: current.code, filledDelta: balance.outstanding, emptyDelta: 0, withCustomerDelta: 0, damagedDelta: 0, lostDelta: 0, maintenanceDelta: 0, remarks: `Purged customer ${current.partyName}`, createdAt }).run()
        continue
      }
      if ((filled > 0 && empty > 0) || (filled === 0 && empty === 0)) {
        throw new BusinessError('This customer has an outstanding balance whose cylinder condition cannot be determined safely. Clear or reconcile the balance before permanently deleting the customer.')
      }
      if (filled > 0) {
        db.run(sql`UPDATE inventory_balances SET filled_available = filled_available + ${balance.outstanding}, with_customer = MAX(0, with_customer - ${balance.outstanding}), updated_at = ${createdAt} WHERE size_id = ${balance.sizeId}`)
        db.insert(inventoryMovements).values({ sizeId: balance.sizeId, customerId: null, movementDate: createdAt.slice(0, 10), movementType: 'customer_purge', referenceNumber: current.code, filledDelta: balance.outstanding, emptyDelta: 0, withCustomerDelta: 0, damagedDelta: 0, lostDelta: 0, maintenanceDelta: 0, remarks: `Purged customer ${current.partyName}`, createdAt }).run()
      } else {
        db.run(sql`UPDATE inventory_balances SET empty_available = empty_available + ${balance.outstanding}, with_customer = MAX(0, with_customer - ${balance.outstanding}), updated_at = ${createdAt} WHERE size_id = ${balance.sizeId}`)
        db.insert(inventoryMovements).values({ sizeId: balance.sizeId, customerId: null, movementDate: createdAt.slice(0, 10), movementType: 'customer_purge', referenceNumber: current.code, filledDelta: 0, emptyDelta: balance.outstanding, withCustomerDelta: 0, damagedDelta: 0, lostDelta: 0, maintenanceDelta: 0, remarks: `Purged customer ${current.partyName}`, createdAt }).run()
      }
    }
    db.run(sql`UPDATE cylinders SET status = 'available', customer_id = NULL, updated_at = ${createdAt} WHERE customer_id = ${id}`)
    // Keep the global movement trail intact while removing the customer's
    // identity from it; serial ownership/movements are still reset below.
    db.run(sql`UPDATE cylinder_movements SET customer_id = NULL WHERE customer_id = ${id}`)
    db.run(sql`DELETE FROM dispatch_item_serials WHERE dispatch_item_id IN (SELECT id FROM dispatch_items WHERE dispatch_id IN (SELECT id FROM dispatches WHERE customer_id = ${id}))`)
    db.run(sql`DELETE FROM return_item_serials WHERE return_item_id IN (SELECT id FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE customer_id = ${id}))`)
    db.run(sql`DELETE FROM dispatch_items WHERE dispatch_id IN (SELECT id FROM dispatches WHERE customer_id = ${id})`)
    db.run(sql`DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE customer_id = ${id})`)
    db.run(sql`DELETE FROM dispatches WHERE customer_id = ${id}`)
    db.run(sql`DELETE FROM returns WHERE customer_id = ${id}`)
    db.run(sql`DELETE FROM customer_ledger_entries WHERE customer_id = ${id}`)
    db.run(sql`DELETE FROM customer_opening_balances WHERE customer_id = ${id}`)
    // For sizes with an outstanding balance, replace the customer's original
    // movements with the explicit purge movement above. Zero-balance history
    // is anonymised rather than removed so stock totals remain consistent.
    db.run(sql`DELETE FROM inventory_movements WHERE customer_id = ${id} AND size_id IN (SELECT size_id FROM customer_balances WHERE customer_id = ${id} AND outstanding > 0)`)
    db.run(sql`UPDATE inventory_movements SET customer_id = NULL WHERE customer_id = ${id}`)
    db.run(sql`DELETE FROM customer_balances WHERE customer_id = ${id}`)
    db.run(sql`DELETE FROM reconciliations WHERE customer_id = ${id}`)
    db.run(sql`DELETE FROM month_end_snapshot_items WHERE customer_id = ${id}`)
    db.run(sql`UPDATE month_end_snapshots SET customer_count = (SELECT count(*) FROM month_end_snapshot_items WHERE snapshot_id = month_end_snapshots.id), total_with_customers = coalesce((SELECT sum(total_outstanding) FROM month_end_snapshot_items WHERE snapshot_id = month_end_snapshots.id), 0)`)
    db.delete(customers).where(eq(customers.id, id)).run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'customer_purge',
      entityType: 'customer',
      entityId: String(id),
      summary: `Customer ${current.code} ${current.partyName} and all related records were permanently deleted.`,
    })
    assertConsistent(db)
    return { deleted: true }
  })
}

export function customerOutstanding(db: Db, customerId: number, sizeId: number) {
  return getOutstanding(db, customerId, sizeId)
}
