import { existsSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { nowIso } from '@shared/dates'
import { MIGRATION_001 } from './migration'
import * as schema from './schema'
import { applicationSettings, companies, cylinderSizes, inventoryBalances, users } from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export type AppContext = {
  sqlite: Database.Database
  db: Db
  path: string
  now: () => Date
}

const CURRENT_SCHEMA_COLUMNS: Record<string, string[]> = {
  companies: ['id', 'name', 'updated_at'],
  users: ['id', 'name', 'role', 'created_at'],
  cylinder_sizes: ['id', 'code', 'name', 'capacity_litres', 'sort_order', 'is_active', 'created_at'],
  customers: ['id', 'code', 'party_name', 'created_at', 'updated_at'],
  inventory_balances: ['size_id', 'filled_available', 'empty_available', 'with_customer', 'damaged', 'lost', 'under_maintenance', 'updated_at'],
  dispatches: ['id', 'number', 'dispatch_date', 'customer_id'],
  returns: ['id', 'number', 'return_date', 'customer_id'],
  application_settings: ['key', 'value'],
}

type DatabaseSchemaKind = 'empty' | 'current' | 'incompatible'

function columnNames(sqlite: Database.Database, table: string) {
  return new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name))
}

export function classifyDatabaseSchema(sqlite: Database.Database): DatabaseSchemaKind {
  const tables = new Set(
    (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map(
      (row) => row.name,
    ),
  )
  if (tables.size === 0) return 'empty'

  for (const [table, requiredColumns] of Object.entries(CURRENT_SCHEMA_COLUMNS)) {
    if (!tables.has(table)) return 'incompatible'
    const columns = columnNames(sqlite, table)
    if (!requiredColumns.every((column) => columns.has(column))) return 'incompatible'
  }

  const integerIdTables = ['companies', 'users', 'cylinder_sizes', 'customers', 'dispatches', 'returns']
  for (const table of integerIdTables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[]
    const id = columns.find((column) => column.name === 'id')
    if (!id || id.type.toUpperCase() !== 'INTEGER') return 'incompatible'
  }
  return 'current'
}

function currentDatabasePath(primaryPath: string) {
  const parsed = path.parse(primaryPath)
  return path.join(parsed.dir, `${parsed.name}-v2${parsed.ext || '.db'}`)
}

/**
 * Older CylinderFlow releases used an unrelated TEXT-id schema at the same
 * user-data path. Keep that database byte-for-byte intact and use a separate,
 * deterministic database for this schema generation.
 */
export function resolveCompatibleDatabasePath(primaryPath: string) {
  if (!existsSync(primaryPath)) return primaryPath

  const primary = new Database(primaryPath, { readonly: true, fileMustExist: true })
  let primaryKind: DatabaseSchemaKind
  try {
    primaryKind = classifyDatabaseSchema(primary)
  } finally {
    primary.close()
  }
  if (primaryKind === 'empty' || primaryKind === 'current') return primaryPath

  const fallbackPath = currentDatabasePath(primaryPath)
  if (!existsSync(fallbackPath)) return fallbackPath

  const fallback = new Database(fallbackPath, { readonly: true, fileMustExist: true })
  try {
    const fallbackKind = classifyDatabaseSchema(fallback)
    if (fallbackKind === 'empty' || fallbackKind === 'current') return fallbackPath
  } finally {
    fallback.close()
  }
  throw new Error(`Neither ${path.basename(primaryPath)} nor ${path.basename(fallbackPath)} uses a supported CylinderFlow database schema.`)
}

const DEFAULT_SIZES = [
  { code: '3L', name: '3 Litre', capacityLitres: 3, sortOrder: 1 },
  { code: '10L', name: '10 Litre', capacityLitres: 10, sortOrder: 2 },
  { code: '23L', name: '23 Litre', capacityLitres: 23, sortOrder: 3 },
]

const DEFAULT_SETTINGS: Record<string, string> = {
  overdue_threshold_days: '30',
  date_format: 'dd MMM yyyy',
  currency: 'INR',
  theme: 'light',
  auto_backup: 'true',
  backup_retention: '15',
  backup_directory: '',
  notify_month_end: 'true',
  notify_native: 'true',
  operator_name: 'Administrator',
  demo_loaded: 'false',
}

export function applyPragmas(sqlite: Database.Database) {
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')
}

export function openDatabase(dbPath: string, options?: { now?: () => Date }): AppContext {
  const compatiblePath = resolveCompatibleDatabasePath(dbPath)
  const sqlite = new Database(compatiblePath)
  applyPragmas(sqlite)
  migrate(sqlite)
  const ctx: AppContext = {
    sqlite,
    db: drizzle(sqlite, { schema }),
    path: compatiblePath,
    now: options?.now ?? (() => new Date()),
  }
  seed(ctx)
  return ctx
}

export function closeDatabase(ctx: AppContext) {
  try {
    ctx.sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // The file may already be closed during restore.
  }
  ctx.sqlite.close()
}

export function reconnect(ctx: AppContext) {
  ctx.sqlite = new Database(ctx.path)
  applyPragmas(ctx.sqlite)
  ctx.db = drizzle(ctx.sqlite, { schema })
}

function migrate(sqlite: Database.Database) {
  const migrationColumns = sqlite
    .prepare(`PRAGMA table_info(schema_migrations)`)
    .all() as { name: string }[]
  if (migrationColumns.length > 0 && !migrationColumns.some((column) => column.name === 'name')) {
    sqlite.exec(`ALTER TABLE schema_migrations RENAME TO schema_migrations_legacy`)
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)
  const existing = sqlite.prepare('SELECT name FROM schema_migrations WHERE name = ?').get('001_init')
  if (existing) return
  if (classifyDatabaseSchema(sqlite) === 'current') {
    sqlite.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('001_init', new Date().toISOString())
    return
  }
  const run = sqlite.transaction(() => {
    sqlite.exec(MIGRATION_001)
    sqlite.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('001_init', new Date().toISOString())
  })
  run()
}

function seed(ctx: AppContext) {
  const stamp = nowIso(ctx.now())
  const company = ctx.db.select().from(companies).get()
  if (!company) {
    ctx.db.insert(companies).values({ id: 1, name: 'Your Company', updatedAt: stamp }).run()
  }
  const user = ctx.db.select().from(users).get()
  if (!user) {
    ctx.db.insert(users).values({ name: 'Administrator', role: 'admin', createdAt: stamp }).run()
  }
  for (const size of DEFAULT_SIZES) {
    ctx.db
      .insert(cylinderSizes)
      .values({ ...size, isActive: 1, createdAt: stamp })
      .onConflictDoNothing()
      .run()
  }
  const sizes = ctx.db.select().from(cylinderSizes).all()
  for (const size of sizes) {
    const balance = ctx.db.select().from(inventoryBalances).where(eq(inventoryBalances.sizeId, size.id)).get()
    if (!balance) {
      ctx.db.insert(inventoryBalances).values({ sizeId: size.id, updatedAt: stamp }).run()
    }
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    ctx.db.insert(applicationSettings).values({ key, value }).onConflictDoNothing().run()
  }
  const installed = ctx.db.select().from(applicationSettings).where(eq(applicationSettings.key, 'installed_on')).get()
  if (!installed) {
    ctx.db.insert(applicationSettings).values({ key: 'installed_on', value: stamp }).run()
  }
}

export function inTx<T>(ctx: AppContext, fn: (db: Db) => T): T {
  return ctx.db.transaction((tx) => fn(tx as unknown as Db))
}

export function rows<T>(ctx: AppContext, query: string, params: unknown[] = []): T[] {
  return ctx.sqlite.prepare(query).all(...params) as T[]
}

export function one<T>(ctx: AppContext, query: string, params: unknown[] = []): T | undefined {
  return ctx.sqlite.prepare(query).get(...params) as T | undefined
}

export function setting(db: Db, key: string, fallback = ''): string {
  const row = db.select().from(applicationSettings).where(eq(applicationSettings.key, key)).get()
  return row?.value ?? fallback
}

export function putSetting(db: Db, key: string, value: string) {
  const existing = db.select().from(applicationSettings).where(eq(applicationSettings.key, key)).get()
  if (existing) {
    db.update(applicationSettings).set({ value }).where(eq(applicationSettings.key, key)).run()
  } else {
    db.insert(applicationSettings).values({ key, value }).run()
  }
}
