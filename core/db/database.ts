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
  const sqlite = new Database(dbPath)
  applyPragmas(sqlite)
  migrate(sqlite)
  const ctx: AppContext = {
    sqlite,
    db: drizzle(sqlite, { schema }),
    path: dbPath,
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
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)
  const existing = sqlite.prepare('SELECT name FROM schema_migrations WHERE name = ?').get('001_init')
  if (existing) return
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
