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
} from '../db/schema'
import { BusinessError } from './errors'
import { actorName, stamp, writeAudit } from './stock'
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
    if (['3L', '10L', '23L'].includes(current.code)) {
      throw new BusinessError('Default cylinder sizes cannot be deleted. Deactivate them instead when they are unused.')
    }
    const balance = db.select().from(inventoryBalances).where(eq(inventoryBalances.sizeId, id)).get()
    const hasInventory = Boolean(
      balance &&
        (balance.filledAvailable ||
          balance.emptyAvailable ||
          balance.withCustomer ||
          balance.damaged ||
          balance.lost ||
          balance.underMaintenance),
    )
    const references = [
      ['inventory balances', hasInventory ? 1 : 0],
      ['opening balances', db.select({ n: sql<number>`count(*)` }).from(openingBalances).where(eq(openingBalances.sizeId, id)).get()?.n],
      ['customer balances', db.select({ n: sql<number>`count(*)` }).from(customerBalances).where(eq(customerBalances.sizeId, id)).get()?.n],
      ['customer opening balances', db.select({ n: sql<number>`count(*)` }).from(customerOpeningBalances).where(eq(customerOpeningBalances.sizeId, id)).get()?.n],
      ['dispatch items', db.select({ n: sql<number>`count(*)` }).from(dispatchItems).where(eq(dispatchItems.sizeId, id)).get()?.n],
      ['return items', db.select({ n: sql<number>`count(*)` }).from(returnItems).where(eq(returnItems.sizeId, id)).get()?.n],
      ['ledger entries', db.select({ n: sql<number>`count(*)` }).from(customerLedgerEntries).where(eq(customerLedgerEntries.sizeId, id)).get()?.n],
      ['inventory movements', db.select({ n: sql<number>`count(*)` }).from(inventoryMovements).where(eq(inventoryMovements.sizeId, id)).get()?.n],
      ['inventory adjustments', db.select({ n: sql<number>`count(*)` }).from(inventoryAdjustments).where(eq(inventoryAdjustments.sizeId, id)).get()?.n],
      ['reconciliations', db.select({ n: sql<number>`count(*)` }).from(reconciliations).where(eq(reconciliations.sizeId, id)).get()?.n],
    ] as const
    const blocking = references.find(([, count]) => Number(count ?? 0) > 0)
    if (blocking) {
      throw new BusinessError(`Cannot delete ${current.name}. It has ${blocking[0]}; deactivate it instead to preserve the history.`)
    }
    const { createdAt } = stamp(ctx.now())
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
    return { deleted: true }
  })
}

export function defaultBackupDir(ctx: AppContext) {
  const custom = setting(ctx.db, 'backup_directory', '').trim()
  return custom || path.join(path.dirname(ctx.path), 'backups')
}
