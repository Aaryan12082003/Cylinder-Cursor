import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { nowIso } from '@shared/dates'
import type { BackupRecord } from '@shared/types'
import { applyPragmas, migrateDatabase, type AppContext } from '../db/database'
import { putSetting, setting } from '../db/database'
import * as schema from '../db/schema'
import { backupHistory } from '../db/schema'
import { BusinessError } from './errors'
import { defaultBackupDir } from './settings'
import { actorName, stamp, writeAudit } from './stock'

export function checkFileIntegrity(filePath: string): { ok: boolean; message: string } {
  const sqlite = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const row = sqlite.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    return { ok: row.integrity_check === 'ok', message: row.integrity_check }
  } finally {
    sqlite.close()
  }
}

export function integrityCheck(ctx: AppContext) {
  const row = ctx.sqlite.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
  return { ok: row.integrity_check === 'ok', message: row.integrity_check }
}

async function copyDatabase(sqlite: Database.Database, dest: string) {
  const backup = sqlite.backup as ((destination: string) => Promise<unknown>) | undefined
  if (typeof backup === 'function') {
    await backup.call(sqlite, dest)
    return
  }
  const escaped = dest.replaceAll("'", "''")
  sqlite.exec(`VACUUM INTO '${escaped}'`)
}

function removeSidecars(filePath: string) {
  fs.rmSync(`${filePath}-wal`, { force: true })
  fs.rmSync(`${filePath}-shm`, { force: true })
}

export function listBackups(ctx: AppContext): BackupRecord[] {
  return ctx.db
    .select()
    .from(backupHistory)
    .orderBy(desc(backupHistory.id))
    .all()
    .map((row) => ({
      id: row.id,
      filePath: row.filePath,
      fileSize: row.fileSize,
      createdAt: row.createdAt,
      kind: row.kind,
      note: row.note ?? '',
    }))
}

export async function createBackup(ctx: AppContext, directory: string, kind: 'manual' | 'auto', note = ''): Promise<BackupRecord> {
  fs.mkdirSync(directory, { recursive: true })
  const filename = `cylinderflow-${nowIso(ctx.now()).replaceAll(':', '-').replaceAll('.', '-')}.db`
  const dest = path.join(directory, filename)
  await copyDatabase(ctx.sqlite, dest)
  const check = checkFileIntegrity(dest)
  if (!check.ok) {
    fs.rmSync(dest, { force: true })
    throw new BusinessError('The backup failed its integrity check and was discarded.')
  }
  const createdAt = nowIso(ctx.now())
  const inserted = ctx.db
    .insert(backupHistory)
    .values({ filePath: dest, fileSize: fs.statSync(dest).size, createdAt, kind, note: note || null })
    .returning()
    .all()[0]
  if (!inserted) throw new BusinessError('Backup history could not be saved.')
  pruneBackups(ctx, directory)
  writeAudit(ctx.db, {
    occurredAt: createdAt,
    actor: actorName(ctx.db),
    action: 'backup',
    entityType: 'backup',
    entityId: String(inserted.id),
    summary: `${kind === 'auto' ? 'Automatic' : 'Manual'} backup saved.`,
  })
  return {
    id: inserted.id,
    filePath: inserted.filePath,
    fileSize: inserted.fileSize,
    createdAt: inserted.createdAt,
    kind: inserted.kind,
    note: inserted.note ?? '',
  }
}

function pruneBackups(ctx: AppContext, directory: string) {
  const keep = Math.max(1, Number(setting(ctx.db, 'backup_retention', '15')))
  const records = ctx.db.select().from(backupHistory).orderBy(desc(backupHistory.id)).all()
  const extra = records.slice(keep)
  for (const record of extra) {
    if (path.dirname(record.filePath) === directory && record.filePath.includes('cylinderflow-')) {
      fs.rmSync(record.filePath, { force: true })
    }
    ctx.db.delete(backupHistory).where(eq(backupHistory.id, record.id)).run()
  }
}

export async function autoBackup(ctx: AppContext) {
  if (setting(ctx.db, 'auto_backup', 'true') === 'false') return null
  return createBackup(ctx, defaultBackupDir(ctx), 'auto', 'Automatic backup on launch')
}

export function restoreFromFile(ctx: AppContext, filePath: string) {
  if (!fs.existsSync(filePath)) throw new BusinessError('Backup file was not found.')
  const check = checkFileIntegrity(filePath)
  if (!check.ok) throw new BusinessError('This backup failed the integrity check and was not restored.')
  const safety = `${ctx.path}.before-restore`
  try {
    ctx.sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Continue with the file copy.
  }
  ctx.sqlite.close()
  removeSidecars(ctx.path)
  fs.copyFileSync(ctx.path, safety)
  try {
    fs.copyFileSync(filePath, ctx.path)
    removeSidecars(ctx.path)
    ctx.sqlite = new Database(ctx.path)
    applyPragmas(ctx.sqlite)
    migrateDatabase(ctx.sqlite)
    ctx.db = drizzle(ctx.sqlite, { schema })
    const live = integrityCheck(ctx)
    if (!live.ok) throw new BusinessError('Restored database failed the integrity check. The previous database was put back.')
    const { createdAt } = stamp(ctx.now())
    writeAudit(ctx.db, {
      occurredAt: createdAt,
      actor: 'Administrator',
      action: 'restore',
      entityType: 'backup',
      summary: `Database restored from ${path.basename(filePath)}.`,
    })
  } catch (error) {
    try {
      ctx.sqlite.close()
    } catch {
      // The handle may already be closed.
    }
    fs.copyFileSync(safety, ctx.path)
    removeSidecars(ctx.path)
    ctx.sqlite = new Database(ctx.path)
    applyPragmas(ctx.sqlite)
    migrateDatabase(ctx.sqlite)
    ctx.db = drizzle(ctx.sqlite, { schema })
    if (error instanceof BusinessError) throw error
    throw new BusinessError('Restore failed. The previous database was put back.')
  }
}

export function setBackupDirectory(ctx: AppContext, directory: string) {
  putSetting(ctx.db, 'backup_directory', directory)
  return directory
}
