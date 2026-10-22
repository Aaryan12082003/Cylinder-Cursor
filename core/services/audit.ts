import { and, desc, eq, sql } from 'drizzle-orm'
import type { AuditRow, Page } from '@shared/types'
import type { AppContext } from '../db/database'
import { auditLogs } from '../db/schema'
import { likePattern } from './text'

export function listAudit(
  ctx: AppContext,
  query: { page: number; pageSize: number; search?: string; action?: string; sortDir?: 'asc' | 'desc' },
): Page<AuditRow> {
  const filters = []
  if (query.action) filters.push(eq(auditLogs.action, query.action))
  if (query.search?.trim()) {
    const pattern = likePattern(query.search)
    filters.push(sql`(
      lower(${auditLogs.summary}) like ${pattern} escape '\\'
      or lower(${auditLogs.actor}) like ${pattern} escape '\\'
      or lower(${auditLogs.action}) like ${pattern} escape '\\'
      or lower(coalesce(${auditLogs.entityId}, '')) like ${pattern} escape '\\'
    )`)
  }
  const where = filters.length ? and(...filters) : undefined
  const total = Number(ctx.db.select({ n: sql<number>`count(*)` }).from(auditLogs).where(where).get()?.n ?? 0)
  const found = ctx.db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(query.sortDir === 'asc' ? auditLogs.id : desc(auditLogs.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()
  return {
    rows: found.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      actor: row.actor,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? '',
      summary: row.summary,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}
