import { desc, eq, isNull, sql } from 'drizzle-orm'
import type { AppNotification, Page } from '@shared/types'
import type { AppContext } from '../db/database'
import { inTx } from '../db/database'
import { notifications } from '../db/schema'
import { BusinessError } from './errors'
import { nowIso } from '@shared/dates'

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
