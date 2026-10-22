import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDatabase, openDatabase, type AppContext } from '../core/db/database'
import type { Host } from '../core/host'
import { listSizeBalances } from '../core/services/inventory'

export function tempContext(now?: () => Date) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cylinderflow-'))
  const ctx = openDatabase(path.join(dir, 'cylinderflow.db'), now ? { now } : undefined)
  const sizes = Object.fromEntries(listSizeBalances(ctx.db).map((size) => [size.code, size.id])) as Record<string, number>
  return {
    dir,
    ctx,
    sizes,
    close: () => closeDatabase(ctx),
  }
}

export function fakeHost(dir: string, ctx: AppContext): Host {
  return {
    pickDirectory: async () => dir,
    pickOpenFile: async () => null,
    saveBytes: async (request) => {
      const file = path.join(dir, request.defaultName)
      fs.writeFileSync(file, request.bytes)
      return file
    },
    chooseLogo: async () => null,
    notify: () => {},
  }
  void ctx
}
