import fs from 'node:fs'
import path from 'node:path'
import type { AppContext } from '../db/database'

/**
 * Permanently removes all operational records while retaining the company's
 * identity, application preferences, cylinder-size definitions, and users.
 *
 * This deliberately uses the native SQLite transaction so foreign-key checks
 * remain enabled for the whole database operation. Backup-file cleanup is
 * best-effort after commit because filesystem deletes cannot participate in
 * the SQLite transaction.
 */
export function purgeOperationalData(ctx: AppContext) {
  const updatedAt = ctx.now().toISOString()
  const backupFiles = (ctx.sqlite.prepare('SELECT file_path AS filePath FROM backup_history').all() as { filePath: string }[])
    .map((row) => row.filePath)
    .filter((filePath) => path.basename(filePath).startsWith('cylinderflow-') && path.extname(filePath) === '.db')
  const run = ctx.sqlite.transaction(() => {
    // Delete dependent rows before their referenced documents/entities.
    ctx.sqlite.exec(`
      DELETE FROM dispatch_item_serials;
      DELETE FROM return_item_serials;
      DELETE FROM month_end_snapshot_items;
      DELETE FROM cylinder_movements;
      DELETE FROM dispatch_items;
      DELETE FROM return_items;
      DELETE FROM customer_ledger_entries;
      DELETE FROM customer_opening_balances;
      DELETE FROM customer_balances;
      DELETE FROM inventory_adjustments;
      DELETE FROM reconciliations;
      DELETE FROM inventory_movements;
      DELETE FROM opening_balances;
      DELETE FROM dispatches;
      DELETE FROM returns;
      DELETE FROM month_end_snapshots;
      DELETE FROM notifications;
      DELETE FROM audit_logs;
      DELETE FROM backup_history;
      DELETE FROM cylinders;
      DELETE FROM customers;
      DELETE FROM document_sequences;
    `)

    // Keep one zeroed balance row per configured cylinder size. The rows are
    // structural state used by inventory screens and are required by the
    // existing seed/integrity conventions.
    ctx.sqlite
      .prepare(`
        UPDATE inventory_balances
        SET filled_available = 0,
            empty_available = 0,
            with_customer = 0,
            damaged = 0,
            lost = 0,
            under_maintenance = 0,
            updated_at = ?
      `)
      .run(updatedAt)

    // This is an internal lifecycle marker rather than a user preference.
    // Reset it so the empty database cannot report stale demonstration data.
    ctx.sqlite.prepare(`UPDATE application_settings SET value = 'false' WHERE key = 'demo_loaded'`).run()
  })

  run()
  let backupCleanupIncomplete = false
  for (const filePath of backupFiles) {
    try {
      fs.rmSync(filePath, { force: true })
      fs.rmSync(`${filePath}-wal`, { force: true })
      fs.rmSync(`${filePath}-shm`, { force: true })
    } catch {
      backupCleanupIncomplete = true
    }
  }
  return { deleted: true, backupCleanupIncomplete }
}
