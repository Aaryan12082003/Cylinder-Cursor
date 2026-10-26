import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import type { CompanyInput, SettingsInput } from '@shared/schemas'
import type { AppSettings } from '@shared/types'
import type { AppContext } from '../db/database'
import { inTx, putSetting, setting } from '../db/database'
import {
  companies,
  customerBalances,
  customerLedgerEntries,
  customerOpeningBalances,
  cylinderSizes,
  dispatchItems,
  inventoryAdjustments,
  inventoryBalances,
  inventoryMovements,
  openingBalances,
  reconciliations,
  returnItems,
  routes,
} from '../db/schema'
import { BusinessError } from './errors'
import { actorName, assertConsistent, stamp, writeAudit } from './stock'
import { clean, nullIfEmpty } from './text'

function brandingDir(ctx: AppContext) {
  return path.join(path.dirname(ctx.path), 'branding')
}

function readLogo(filePath: string | null): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null
  const stat = fs.statSync(filePath)
  if (stat.size > 2_000_000) return null
  const bytes = fs.readFileSync(filePath)
  const kind = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return `data:${kind};base64,${bytes.toString('base64')}`
}

export function getSettings(ctx: AppContext): AppSettings {
  const company = ctx.db.select().from(companies).get()
  const sizes = ctx.db.select().from(cylinderSizes).orderBy(cylinderSizes.sortOrder).all()
  const routeRows = ctx.db.select().from(routes).orderBy(routes.name).all()
  return {
    overdueThresholdDays: Number(setting(ctx.db, 'overdue_threshold_days', '30')),
    dateFormat: setting(ctx.db, 'date_format', 'dd MMM yyyy'),
    currency: setting(ctx.db, 'currency', 'INR'),
    theme: setting(ctx.db, 'theme', 'light') === 'dark' ? 'dark' : 'light',
    autoBackup: setting(ctx.db, 'auto_backup', 'true') !== 'false',
    backupRetention: Number(setting(ctx.db, 'backup_retention', '15')),
    backupDirectory: setting(ctx.db, 'backup_directory', ''),
    notifyMonthEnd: setting(ctx.db, 'notify_month_end', 'true') !== 'false',
    notifyNative: setting(ctx.db, 'notify_native', 'true') !== 'false',
    operatorName: setting(ctx.db, 'operator_name', 'Administrator'),
    installedOn: setting(ctx.db, 'installed_on', ''),
    demoLoaded: setting(ctx.db, 'demo_loaded', 'false') === 'true',
    company: {
      name: company?.name ?? 'Your Company',
      address: company?.address ?? '',
      gstNumber: company?.gstNumber ?? '',
      phone: company?.phone ?? '',
      email: company?.email ?? '',
      logoDataUrl: readLogo(company?.logoPath ?? null),
    },
    sizes: sizes.map((size) => ({
      id: size.id,
      code: size.code,
      name: size.name,
      capacityLitres: size.capacityLitres,
      isActive: Boolean(size.isActive),
      sortOrder: size.sortOrder,
    })),
    routes: routeRows.map((route) => ({ id: route.id, name: route.name, isActive: Boolean(route.isActive), createdAt: route.createdAt, updatedAt: route.updatedAt })),
  }
}

export function updateSettings(ctx: AppContext, input: SettingsInput) {
  return inTx(ctx, (db) => {
    const { createdAt } = stamp(ctx.now())
    const pairs: Record<string, string> = {
      overdue_threshold_days: String(input.overdueThresholdDays),
      date_format: input.dateFormat,
      currency: input.currency,
      theme: input.theme,
      auto_backup: input.autoBackup ? 'true' : 'false',
      backup_retention: String(input.backupRetention),
      backup_directory: input.backupDirectory.trim(),
      notify_month_end: input.notifyMonthEnd ? 'true' : 'false',
      notify_native: input.notifyNative ? 'true' : 'false',
      operator_name: clean(input.operatorName, 80),
    }
    for (const [key, value] of Object.entries(pairs)) putSetting(db, key, value)
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'settings_update',
      entityType: 'settings',
      summary: 'Application settings updated.',
    })
    return true
  })
}

export function updateCompany(ctx: AppContext, input: CompanyInput) {
  return inTx(ctx, (db) => {
    const { createdAt } = stamp(ctx.now())
    db.update(companies)
      .set({
        name: clean(input.name, 160),
        address: nullIfEmpty(input.address, 400),
        gstNumber: input.gstNumber ? clean(input.gstNumber, 15).toUpperCase() : null,
        phone: nullIfEmpty(input.phone, 20),
        email: nullIfEmpty(input.email, 120),
        updatedAt: createdAt,
      })
      .where(eq(companies.id, 1))
      .run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'company_update',
      entityType: 'company',
      entityId: '1',
      summary: `Company profile updated to ${clean(input.name, 160)}.`,
    })
    return true
  })
}

export function saveLogo(ctx: AppContext, sourcePath: string) {
  const bytes = fs.readFileSync(sourcePath)
  if (bytes.length > 2_000_000) throw new BusinessError('Logo must be smaller than 2 MB.')
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8
  if (!isPng && !isJpg) throw new BusinessError('Use a PNG or JPG logo.')
  const ext = isPng ? '.png' : '.jpg'
  const dir = brandingDir(ctx)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `logo${ext}`)
  fs.writeFileSync(dest, bytes)
  const { createdAt } = stamp(ctx.now())
  ctx.db.update(companies).set({ logoPath: dest, updatedAt: createdAt }).where(eq(companies.id, 1)).run()
  writeAudit(ctx.db, {
    occurredAt: createdAt,
    actor: actorName(ctx.db),
    action: 'company_logo',
    entityType: 'company',
    entityId: '1',
    summary: 'Company logo updated.',
  })
  return true
}

export function addCylinderSize(ctx: AppContext, input: { code: string; name: string; capacityLitres: number }) {
  return inTx(ctx, (db) => {
    const { createdAt } = stamp(ctx.now())
    const code = clean(input.code, 12).toUpperCase()
    const existing = db.select().from(cylinderSizes).all()
    if (existing.some((size) => size.code.toLowerCase() === code.toLowerCase())) {
      throw new BusinessError('That cylinder size code already exists.')
    }
    const sortOrder = Math.max(0, ...existing.map((size) => size.sortOrder)) + 1
    const created = db
      .insert(cylinderSizes)
      .values({ code, name: clean(input.name, 40), capacityLitres: input.capacityLitres, sortOrder, isActive: 1, createdAt })
      .returning()
      .all()[0]
    if (!created) throw new BusinessError('Cylinder size could not be saved.')
    db.insert(inventoryBalances).values({ sizeId: created.id, updatedAt: createdAt }).run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'size_create',
      entityType: 'cylinder_size',
      entityId: String(created.id),
      summary: `Cylinder size ${created.name} added.`,
    })
    return { id: created.id }
  })
}

export function updateCylinderSize(
  ctx: AppContext,
  input: { id: number; code: string; name: string; capacityLitres: number; isActive: boolean },
) {
  return inTx(ctx, (db) => {
    const current = db.select().from(cylinderSizes).where(eq(cylinderSizes.id, input.id)).get()
    if (!current) throw new BusinessError('Cylinder size not found.')
    const code = clean(input.code, 12).toUpperCase()
    const duplicate = db
      .select({ id: cylinderSizes.id })
      .from(cylinderSizes)
      .where(sql`upper(${cylinderSizes.code}) = ${code} AND ${cylinderSizes.id} != ${input.id}`)
      .get()
    if (duplicate) throw new BusinessError('That cylinder size code already exists.')
    if (!input.isActive && current.isActive) {
      const balance = db.select().from(inventoryBalances).where(eq(inventoryBalances.sizeId, input.id)).get()
      const busy =
        (balance?.filledAvailable ?? 0) +
        (balance?.emptyAvailable ?? 0) +
        (balance?.withCustomer ?? 0) +
        (balance?.damaged ?? 0) +
        (balance?.lost ?? 0) +
        (balance?.underMaintenance ?? 0)
      if (busy > 0) throw new BusinessError('Clear this size to zero before deactivating it.')
    }
    const { createdAt } = stamp(ctx.now())
    db.update(cylinderSizes)
      .set({
        code,
        name: clean(input.name, 40),
        capacityLitres: input.capacityLitres,
        isActive: input.isActive ? 1 : 0,
      })
      .where(eq(cylinderSizes.id, input.id))
      .run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'size_update',
      entityType: 'cylinder_size',
      entityId: String(input.id),
      summary: `Cylinder size ${clean(input.name, 40)} updated.`,
    })
    return true
  })
}

export function deleteCylinderSize(ctx: AppContext, id: number) {
  return inTx(ctx, (db) => {
    const current = db.select().from(cylinderSizes).where(eq(cylinderSizes.id, id)).get()
    if (!current) throw new BusinessError('Cylinder size not found.')
    const { createdAt } = stamp(ctx.now())
    // Permanent size deletion purges documents containing this size, then all
    // size-scoped balances, movements, serials, and ledger records.
    db.run(sql`DELETE FROM dispatch_item_serials WHERE dispatch_item_id IN (SELECT id FROM dispatch_items WHERE size_id = ${id})`)
    db.run(sql`DELETE FROM return_item_serials WHERE return_item_id IN (SELECT id FROM return_items WHERE size_id = ${id})`)
    db.run(sql`DELETE FROM dispatch_items WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM return_items WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM dispatches WHERE id NOT IN (SELECT DISTINCT dispatch_id FROM dispatch_items)`)
    db.run(sql`DELETE FROM returns WHERE id NOT IN (SELECT DISTINCT return_id FROM return_items)`)
    // Cylinder movement history is scoped by cylinder, not by customer. Do not
    // remove a customer's movements for other cylinder sizes.
    db.run(sql`DELETE FROM cylinder_movements WHERE cylinder_id IN (SELECT id FROM cylinders WHERE size_id = ${id})`)
    db.run(sql`DELETE FROM cylinders WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM inventory_balances WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM opening_balances WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM customer_balances WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM customer_opening_balances WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM customer_ledger_entries WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM inventory_movements WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM inventory_adjustments WHERE size_id = ${id}`)
    db.run(sql`DELETE FROM reconciliations WHERE size_id = ${id}`)
    db.delete(inventoryBalances).where(eq(inventoryBalances.sizeId, id)).run()
    db.delete(cylinderSizes).where(eq(cylinderSizes.id, id)).run()
    writeAudit(db, {
      occurredAt: createdAt,
      actor: actorName(db),
      action: 'size_delete',
      entityType: 'cylinder_size',
      entityId: String(id),
      summary: `Cylinder size ${current.name} deleted.`,
    })
    assertConsistent(db)
    return { deleted: true }
  })
}

export function defaultBackupDir(ctx: AppContext) {
  const custom = setting(ctx.db, 'backup_directory', '').trim()
  return custom || path.join(path.dirname(ctx.path), 'backups')
}
