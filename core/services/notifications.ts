import { desc, eq, isNull, sql } from 'drizzle-orm'
import type { AppNotification, Page } from '@shared/types'
import type { AppContext } from '../db/database'
import { inTx, setting } from '../db/database'
import { notifications } from '../db/schema'
import { BusinessError } from './errors'
import { formatCount, nowIso } from '@shared/dates'
import { holdingPositions } from './ledger'

function mapNotification(row: typeof notifications.$inferSelect): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    payload: row.payloadJson ? (JSON.parse(row.payloadJson) as Record<string, unknown>) : null,
    readAt: row.readAt,
    createdAt: row.createdAt,
  }
}

export function listNotifications(ctx: AppContext, query: { page: number; pageSize: number; unreadOnly?: boolean }): Page<AppNotification> {
  const where = query.unreadOnly ? isNull(notifications.readAt) : undefined
  const total = Number(ctx.db.select({ n: sql<number>`count(*)` }).from(notifications).where(where).get()?.n ?? 0)
  const found = ctx.db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  return { rows: found.map(mapNotification), total, page: query.page, pageSize: query.pageSize }
}

export function unreadCount(ctx: AppContext): number {
  return Number(
    ctx.db.select({ n: sql<number>`count(*)` }).from(notifications).where(isNull(notifications.readAt)).get()?.n ?? 0,
  )
}

export function markNotificationRead(ctx: AppContext, id: number) {
  const row = ctx.db.select().from(notifications).where(eq(notifications.id, id)).get()
  if (!row) throw new BusinessError('Notification not found.')
  if (!row.readAt) {
    ctx.db.update(notifications).set({ readAt: nowIso(ctx.now()) }).where(eq(notifications.id, id)).run()
  }
  return mapNotification({ ...row, readAt: row.readAt ?? nowIso(ctx.now()) })
}

export function markAllNotificationsRead(ctx: AppContext) {
  return inTx(ctx, (db) => {
    db.update(notifications).set({ readAt: nowIso(ctx.now()) }).where(isNull(notifications.readAt)).run()
    return { unread: 0 }
  })
}

export type OverdueNotification = { title: string; body: string; customerId: number }

/**
 * Creates one in-app notification when a customer's current holding crosses
 * the configured overdue threshold. The dispatch date is part of the dedupe
 * key, so a later dispatch creates a fresh alert after a previous holding is
 * returned.
 */
export function ensureOverdueNotifications(ctx: AppContext): OverdueNotification[] {
  return inTx(ctx, (db) => {
    const threshold = Math.max(1, Number(setting(db, 'overdue_threshold_days', '30')) || 30)
    const now = nowIso(ctx.now())
    const overdue = holdingPositions(ctx).filter((row) => row.overdue)
    const activeKeys = new Set(overdue.map((row) => `overdue:${row.customerId}:${row.lastDispatchDate ?? 'opening'}:${row.alertThresholdDays}`))
    const existing = db.select().from(notifications).where(eq(notifications.kind, 'overdue-holding')).all()

    // Returning all cylinders clears the unread alert for that holding episode.
    for (const row of existing) {
      if (row.readAt || !row.dedupeKey || activeKeys.has(row.dedupeKey)) continue
      db.update(notifications).set({ readAt: now }).where(eq(notifications.id, row.id)).run()
    }

    const created: OverdueNotification[] = []
    for (const row of overdue) {
      const rowThreshold = row.alertThresholdDays
      const dedupeKey = `overdue:${row.customerId}:${row.lastDispatchDate ?? 'opening'}:${rowThreshold}`
      if (existing.some((note) => note.dedupeKey === dedupeKey)) continue
      const breakdown = row.balances
        .filter((balance) => balance.outstanding > 0)
        .map((balance) => `${balance.name}: ${formatCount(balance.outstanding)}`)
        .join(', ')
      const balanceSummary = Object.fromEntries(row.balances.map((balance) => [balance.code, balance.outstanding]))
      const title = `${row.partyName} still has cylinders`
      const body = `${formatCount(row.total)} cylinder${row.total === 1 ? '' : 's'} held for ${row.daysSinceMovement ?? rowThreshold} days (${breakdown}). Alert threshold: ${rowThreshold} days.`
      db.insert(notifications)
        .values({
          kind: 'overdue-holding',
          title,
          body,
          payloadJson: JSON.stringify({
            customerId: row.customerId,
            code: row.code,
            partyName: row.partyName,
            total: row.total,
            daysHeld: row.daysSinceMovement,
            thresholdDays: rowThreshold,
            balances: balanceSummary,
          }),
          createdAt: now,
          dedupeKey,
        })
        .run()
      created.push({ title, body, customerId: row.customerId })
    }
    return created
  })
}
