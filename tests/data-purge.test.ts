import { describe, expect, it } from 'vitest'
import { loadDemoData } from '../core/services/demo'
import { purgeOperationalData } from '../core/services/dataPurge'
import { tempContext } from './helpers'

describe('purgeOperationalData', () => {
  it('clears operational records while retaining configuration', () => {
    const env = tempContext(() => new Date('2026-10-26T10:00:00.000Z'))
    try {
      const companyBefore = env.ctx.sqlite.prepare('SELECT name, address, gst_number FROM companies WHERE id = 1').get()
      const settingsBefore = env.ctx.sqlite.prepare('SELECT key, value FROM application_settings ORDER BY key').all()
      loadDemoData(env.ctx)

      expect(purgeOperationalData(env.ctx)).toEqual({ deleted: true, backupCleanupIncomplete: false })

      const operationalTables = [
        'customers',
        'cylinders',
        'cylinder_movements',
        'customer_balances',
        'customer_opening_balances',
        'dispatches',
        'dispatch_items',
        'dispatch_item_serials',
        'returns',
        'return_items',
        'return_item_serials',
        'customer_ledger_entries',
        'inventory_movements',
        'inventory_adjustments',
        'reconciliations',
        'opening_balances',
        'month_end_snapshots',
        'month_end_snapshot_items',
        'notifications',
        'audit_logs',
        'backup_history',
        'document_sequences',
      ]
      for (const table of operationalTables) {
        expect((env.ctx.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count).toBe(0)
      }
      expect(env.ctx.sqlite.prepare('SELECT COUNT(*) AS count FROM cylinder_sizes').get()).toEqual({ count: 3 })
      expect(env.ctx.sqlite.prepare('SELECT name, address, gst_number FROM companies WHERE id = 1').get()).toEqual(companyBefore)
      expect(env.ctx.sqlite.prepare('SELECT key, value FROM application_settings ORDER BY key').all()).toEqual(settingsBefore)
      expect(env.ctx.sqlite.prepare("SELECT value FROM application_settings WHERE key = 'demo_loaded'").get()).toEqual({ value: 'false' })
      expect(env.ctx.sqlite.prepare('SELECT filled_available, empty_available, with_customer, damaged, lost, under_maintenance FROM inventory_balances').all()).toEqual([
        { filled_available: 0, empty_available: 0, with_customer: 0, damaged: 0, lost: 0, under_maintenance: 0 },
        { filled_available: 0, empty_available: 0, with_customer: 0, damaged: 0, lost: 0, under_maintenance: 0 },
        { filled_available: 0, empty_available: 0, with_customer: 0, damaged: 0, lost: 0, under_maintenance: 0 },
      ])
    } finally {
      env.close()
    }
  })
})
