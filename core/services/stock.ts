import { and, eq, sql } from 'drizzle-orm'
import { nowIso, todayIso } from '@shared/dates'
import type { Db } from '../db/database'
import {
  applicationSettings,
  auditLogs,
  customerBalances,
  customerLedgerEntries,
  cylinderSizes,
  customers,
  documentSequences,
  inventoryBalances,
  inventoryMovements,
} from '../db/schema'
import { BusinessError } from './errors'

export type StateKey = 'filled' | 'empty' | 'with_customer' | 'damaged' | 'lost' | 'maintenance'
export type Deltas = Partial<Record<StateKey, number>>

const fields = {
  filled: 'filledAvailable',
  empty: 'emptyAvailable',
  with_customer: 'withCustomer',
  damaged: 'damaged',
  lost: 'lost',
  maintenance: 'underMaintenance',
} as const

export function stateLabel(state: string): string {
  switch (state) {
    case 'filled':
      return 'filled available'
    case 'empty':
      return 'empty available'
    case 'with_customer':
      return 'with customers'
    case 'damaged':
      return 'damaged'
    case 'lost':
      return 'lost'
    case 'maintenance':
      return 'under maintenance'
    default:
      return 'selected'
  }
}

export function actorName(db: Db): string {
  const row = db.select().from(applicationSettings).where(eq(applicationSettings.key, 'operator_name')).get()
  return row?.value?.trim() || 'Administrator'
}

export function assertNotFuture(date: string, now: Date) {
  if (date > todayIso(now)) throw new BusinessError('Date cannot be in the future.')
}

export function nextNumber(db: Db, name: string, date: string, prefix: string): string {
  const year = name === 'customer' ? 0 : Number(date.slice(0, 4))
  const existing = db
    .select()
    .from(documentSequences)
    .where(and(eq(documentSequences.name, name), eq(documentSequences.year, year)))
    .get()
  const next = (existing?.lastNumber ?? 0) + 1
  if (existing) {
    db.update(documentSequences)
      .set({ lastNumber: next })
      .where(and(eq(documentSequences.name, name), eq(documentSequences.year, year)))
      .run()
  } else {
    db.insert(documentSequences).values({ name, year, lastNumber: next }).run()
  }
  if (name === 'customer') return `CUST-${String(next).padStart(4, '0')}`
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`
}

export function writeAudit(
  db: Db,
  entry: {
    occurredAt: string
    actor: string
    action: string
    entityType: string
    entityId?: string | null
    summary: string
    detail?: unknown
  },
) {
  db.insert(auditLogs)
    .values({
      occurredAt: entry.occurredAt,
      actor: entry.actor,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      detailJson: entry.detail === undefined ? null : JSON.stringify(entry.detail),
    })
    .run()
}

export function requireSize(db: Db, sizeId: number, active = true) {
  const size = db.select().from(cylinderSizes).where(eq(cylinderSizes.id, sizeId)).get()
  if (!size || (active && !size.isActive)) throw new BusinessError('Choose an active cylinder size.')
  return size
}

export function requireCustomer(db: Db, customerId: number, options?: { forDispatch?: boolean }) {
  const customer = db.select().from(customers).where(eq(customers.id, customerId)).get()
  if (!customer) throw new BusinessError('Customer not found.')
  if (options?.forDispatch && (customer.archivedAt || customer.status !== 'active')) {
    throw new BusinessError('Cylinders can only be dispatched to active customers.')
  }
  return customer
}

export function getOutstanding(db: Db, customerId: number, sizeId: number): number {
  const row = db
    .select()
    .from(customerBalances)
    .where(and(eq(customerBalances.customerId, customerId), eq(customerBalances.sizeId, sizeId)))
    .get()
  return row?.outstanding ?? 0
}

export function postCustomerEntry(
  db: Db,
  args: {
    customerId: number
    sizeId: number
    date: string
    transactionType: string
    transactionId: string
    referenceNumber?: string | null
    dispatched?: number
    returned?: number
    adjustment?: number
    remarks?: string | null
    createdAt: string
  },
) {
  const dispatched = args.dispatched ?? 0
  const returned = args.returned ?? 0
  const adjustment = args.adjustment ?? 0
  const delta = dispatched - returned + adjustment
  const opening = getOutstanding(db, args.customerId, args.sizeId)
  const closing = opening + delta
  if (closing < 0) {
    throw new BusinessError('This entry would make the customer outstanding balance negative.')
  }
  if (opening === 0 && closing === 0) {
    db.insert(customerBalances)
      .values({ customerId: args.customerId, sizeId: args.sizeId, outstanding: 0 })
      .onConflictDoNothing()
      .run()
  } else {
    const existing = db
      .select()
      .from(customerBalances)
      .where(and(eq(customerBalances.customerId, args.customerId), eq(customerBalances.sizeId, args.sizeId)))
      .get()
    if (!existing) {
      db.insert(customerBalances)
        .values({ customerId: args.customerId, sizeId: args.sizeId, outstanding: closing })
        .run()
    } else {
      db.update(customerBalances)
        .set({ outstanding: closing })
        .where(and(eq(customerBalances.customerId, args.customerId), eq(customerBalances.sizeId, args.sizeId)))
        .run()
    }
  }
  db.insert(customerLedgerEntries)
    .values({
      customerId: args.customerId,
      sizeId: args.sizeId,
      entryDate: args.date,
      transactionType: args.transactionType,
      transactionId: args.transactionId,
      referenceNumber: args.referenceNumber ?? null,
      openingBalance: opening,
      dispatched,
      returned,
      adjustment,
      closingBalance: closing,
      remarks: args.remarks ?? null,
      createdAt: args.createdAt,
    })
    .run()
  return { opening, closing }
}

export function applyInventory(
  db: Db,
  args: {
    sizeId: number
    deltas: Deltas
    date: string
    movementType: string
    customerId?: number | null
    referenceNumber?: string | null
    remarks?: string | null
    createdAt: string
  },
) {
  const size = db.select().from(cylinderSizes).where(eq(cylinderSizes.id, args.sizeId)).get()
  if (!size) throw new BusinessError('Cylinder size not found.')
  let balance = db.select().from(inventoryBalances).where(eq(inventoryBalances.sizeId, args.sizeId)).get()
  if (!balance) {
    db.insert(inventoryBalances).values({ sizeId: args.sizeId, updatedAt: args.createdAt }).run()
    balance = db.select().from(inventoryBalances).where(eq(inventoryBalances.sizeId, args.sizeId)).get()
  }
  if (!balance) throw new BusinessError('Inventory balance could not be created.')
  const next = {
    filledAvailable: balance.filledAvailable,
    emptyAvailable: balance.emptyAvailable,
    withCustomer: balance.withCustomer,
    damaged: balance.damaged,
    lost: balance.lost,
    underMaintenance: balance.underMaintenance,
  }
  const deltaRow: Record<StateKey, number> = {
    filled: 0,
    empty: 0,
    with_customer: 0,
    damaged: 0,
    lost: 0,
    maintenance: 0,
  }
  for (const [state, delta] of Object.entries(args.deltas) as [StateKey, number][]) {
    if (!delta) continue
    deltaRow[state] += delta
    const field = fields[state]
    const value = next[field] + delta
    if (value < 0) {
      throw new BusinessError(
        `Not enough ${stateLabel(state)} ${size.name} cylinders. Available ${next[field]}, requested ${Math.abs(delta)}.`,
      )
    }
    next[field] = value
  }
  db.update(inventoryBalances)
    .set({ ...next, updatedAt: args.createdAt })
    .where(eq(inventoryBalances.sizeId, args.sizeId))
    .run()
  db.insert(inventoryMovements)
    .values({
      sizeId: args.sizeId,
      customerId: args.customerId ?? null,
      movementDate: args.date,
      movementType: args.movementType,
      referenceNumber: args.referenceNumber ?? null,
      filledDelta: deltaRow.filled,
      emptyDelta: deltaRow.empty,
      withCustomerDelta: deltaRow.with_customer,
      damagedDelta: deltaRow.damaged,
      lostDelta: deltaRow.lost,
      maintenanceDelta: deltaRow.maintenance,
      remarks: args.remarks ?? null,
      createdAt: args.createdAt,
    })
    .run()
}

export function assertUniqueLines(lines: { sizeId: number; condition: string }[]) {
  const seen = new Set<string>()
  for (const line of lines) {
    const key = `${line.sizeId}:${line.condition}`
    if (seen.has(key)) {
      throw new BusinessError('Each cylinder size and condition can only appear once on a document.')
    }
    seen.add(key)
  }
}

export function consistencyProblems(db: Db): string[] {
  const problems: string[] = []
  const sizes = db.select().from(cylinderSizes).all()
  const balances = db.select().from(inventoryBalances).all()
  const movementSums = db
    .select({
      sizeId: inventoryMovements.sizeId,
      filled: sql<number>`coalesce(sum(${inventoryMovements.filledDelta}), 0)`,
      empty: sql<number>`coalesce(sum(${inventoryMovements.emptyDelta}), 0)`,
      withCustomer: sql<number>`coalesce(sum(${inventoryMovements.withCustomerDelta}), 0)`,
      damaged: sql<number>`coalesce(sum(${inventoryMovements.damagedDelta}), 0)`,
      lost: sql<number>`coalesce(sum(${inventoryMovements.lostDelta}), 0)`,
      maintenance: sql<number>`coalesce(sum(${inventoryMovements.maintenanceDelta}), 0)`,
    })
    .from(inventoryMovements)
    .groupBy(inventoryMovements.sizeId)
    .all()
  const ledgerSums = db
    .select({
      customerId: customerLedgerEntries.customerId,
      sizeId: customerLedgerEntries.sizeId,
      outstanding: sql<number>`coalesce(sum(${customerLedgerEntries.dispatched}), 0) - coalesce(sum(${customerLedgerEntries.returned}), 0) + coalesce(sum(${customerLedgerEntries.adjustment}), 0)`,
    })
    .from(customerLedgerEntries)
    .groupBy(customerLedgerEntries.customerId, customerLedgerEntries.sizeId)
    .all()
  const customerRows = db.select().from(customerBalances).all()

  for (const size of sizes) {
    const balance = balances.find((row) => row.sizeId === size.id)
    const movement = movementSums.find((row) => row.sizeId === size.id)
    const expected = {
      filled: Number(movement?.filled ?? 0),
      empty: Number(movement?.empty ?? 0),
      withCustomer: Number(movement?.withCustomer ?? 0),
      damaged: Number(movement?.damaged ?? 0),
      lost: Number(movement?.lost ?? 0),
      maintenance: Number(movement?.maintenance ?? 0),
    }
    const actual = {
      filled: balance?.filledAvailable ?? 0,
      empty: balance?.emptyAvailable ?? 0,
      withCustomer: balance?.withCustomer ?? 0,
      damaged: balance?.damaged ?? 0,
      lost: balance?.lost ?? 0,
      maintenance: balance?.underMaintenance ?? 0,
    }
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (expected[key] !== actual[key]) {
        problems.push(`${size.name} ${key} balance is ${actual[key]} but movements sum to ${expected[key]}.`)
      }
    }
    const ledgerOutstanding = ledgerSums
      .filter((row) => row.sizeId === size.id)
      .reduce((sum, row) => sum + Number(row.outstanding), 0)
    if (ledgerOutstanding !== actual.withCustomer) {
      problems.push(
        `${size.name} cylinders with customers are ${actual.withCustomer} but customer ledgers sum to ${ledgerOutstanding}.`,
      )
    }
  }

  for (const row of customerRows) {
    const ledger = ledgerSums.find((entry) => entry.customerId === row.customerId && entry.sizeId === row.sizeId)
    const expected = Number(ledger?.outstanding ?? 0)
    if (expected !== row.outstanding) {
      problems.push(`Customer ${row.customerId} size ${row.sizeId} outstanding is ${row.outstanding} but the ledger sums to ${expected}.`)
    }
  }
  return problems
}

export function assertConsistent(db: Db) {
  const problems = consistencyProblems(db)
  if (problems.length) throw new BusinessError(`Inventory consistency check failed. ${problems[0]}`)
}

export function stamp(now: Date) {
  return { today: todayIso(now), createdAt: nowIso(now) }
}
