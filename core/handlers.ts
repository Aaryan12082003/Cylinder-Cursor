import { z } from 'zod'
import type { Channel } from '@shared/channels'
import {
  adjustmentSchema,
  archiveSchema,
  auditListSchema,
  companySchema,
  customerCreateSchema,
  customerListSchema,
  customerUpdateSchema,
  deleteAllDataSchema,
  dispatchSchema,
  documentListSchema,
  idSchema,
  ledgerListSchema,
  movementListSchema,
  notificationReadSchema,
  openingStockSchema,
  pageSchema,
  periodSchema,
  reconciliationSchema,
  reportFilterSchema,
  restoreSchema,
  returnSchema,
  reverseSchema,
  searchSchema,
  serialListSchema,
  serialRegistrationSchema,
  settingsUpdateSchema,
  sizeCreateSchema,
  sizeUpdateSchema,
  routeCreateSchema,
  routeUpdateSchema,
  routeDetailSchema,
} from '@shared/schemas'
import type { AppContext } from './db/database'
import type { Host } from './host'
import { listAudit } from './services/audit'
import { createBackup, integrityCheck, listBackups, restoreFromFile, setBackupDirectory } from './services/backup'
import { consistencyProblems } from './services/stock'
import { createCustomer, deleteCustomer, getCustomer, listCustomers, setCustomerArchived, updateCustomer } from './services/customers'
import { loadDemoData, purgeDemoData } from './services/demo'
import { createDispatch, createReturn, getDispatch, getReturn, listDispatches, listReturns, reverseDispatch, reverseReturn } from './services/documents'
import { challanToPdf, reportToExcel, reportToPdf } from './services/exports'
import { adjustInventory, inventoryOverview, listMovements, reconcileCustomer, setOpeningBalances } from './services/inventory'
import { listLedger, listOutstanding } from './services/ledger'
import { listCylinders, registerCylinders } from './services/cylinders'
import { ensureMonthEnd, getMonthEnd, listMonthEnds } from './services/monthEnd'
import { listNotifications, markAllNotificationsRead, markNotificationRead, unreadCount } from './services/notifications'
import { REPORT_CATALOG, runReport } from './services/reports'
import { globalSearch } from './services/search'
import { addCylinderSize, deleteCylinderSize, getSettings, saveLogo, updateCompany, updateCylinderSize, updateSettings, defaultBackupDir } from './services/settings'
import { getDashboard } from './services/dashboard'
import { purgeOperationalData } from './services/dataPurge'
import { BusinessError } from './services/errors'
import { createRoute, deleteRoute, listRoutes, routeDetail, updateRoute } from './services/routes'

const outstandingSchema = pageSchema.extend({
  overdueOnly: z.boolean().optional().default(false),
})

const notificationListSchema = pageSchema.extend({
  unreadOnly: z.boolean().optional().default(false),
})

function parse<S extends z.ZodTypeAny>(schema: S, payload: unknown): z.output<S> {
  return schema.parse(payload ?? {})
}

export function buildHandlers(ctx: AppContext, host: Host): Record<Channel, (payload: unknown) => Promise<unknown> | unknown> {
  return {
    'dashboard:get': () => getDashboard(ctx),
    'inventory:overview': () => inventoryOverview(ctx),
    'inventory:setOpening': (payload) => setOpeningBalances(ctx, parse(openingStockSchema, payload)),
    'inventory:adjust': (payload) => adjustInventory(ctx, parse(adjustmentSchema, payload)),
    'inventory:movements': (payload) => listMovements(ctx, parse(movementListSchema, payload)),
    'cylinders:list': (payload) => listCylinders(ctx, parse(serialListSchema, payload)),
    'cylinders:register': (payload) => registerCylinders(ctx, parse(serialRegistrationSchema, payload)),
    'customers:list': (payload) => listCustomers(ctx, parse(customerListSchema, payload)),
    'customers:get': (payload) => getCustomer(ctx, parse(idSchema, payload).id),
    'customers:create': (payload) => createCustomer(ctx, parse(customerCreateSchema, payload)),
    'customers:update': (payload) => updateCustomer(ctx, parse(customerUpdateSchema, payload)),
    'customers:archive': (payload) => {
      const input = parse(archiveSchema.extend({ archived: z.boolean().optional().default(true) }), payload)
      return setCustomerArchived(ctx, input.id, input.archived)
    },
    'customers:delete': (payload) => deleteCustomer(ctx, parse(idSchema, payload).id),
    'customers:reconcile': (payload) => reconcileCustomer(ctx, parse(reconciliationSchema, payload)),
    'dispatch:list': (payload) => listDispatches(ctx, parse(documentListSchema, payload)),
    'dispatch:get': (payload) => getDispatch(ctx, parse(idSchema, payload).id),
    'dispatch:create': (payload) => createDispatch(ctx, parse(dispatchSchema, payload)),
    'dispatch:reverse': (payload) => {
      const input = parse(reverseSchema, payload)
      return reverseDispatch(ctx, input.id, input.reason)
    },
    'dispatch:challan': async (payload) => {
      const dispatch = getDispatch(ctx, parse(idSchema, payload).id)
      const bytes = await challanToPdf(ctx, dispatch)
      const path = await host.saveBytes({ title: 'Save delivery challan', defaultName: `${dispatch.number}.pdf`, extension: 'pdf', bytes })
      return { path }
    },
    'returns:list': (payload) => listReturns(ctx, parse(documentListSchema, payload)),
    'returns:get': (payload) => getReturn(ctx, parse(idSchema, payload).id),
    'returns:create': (payload) => createReturn(ctx, parse(returnSchema, payload)),
    'returns:reverse': (payload) => {
      const input = parse(reverseSchema, payload)
      return reverseReturn(ctx, input.id, input.reason)
    },
    'ledger:list': (payload) => listLedger(ctx, parse(ledgerListSchema, payload)),
    'outstanding:list': (payload) => listOutstanding(ctx, parse(outstandingSchema, payload)),
    'reports:catalog': () => REPORT_CATALOG,
    'reports:run': (payload) => runReport(ctx, parse(reportFilterSchema, payload)),
    'reports:exportExcel': async (payload) => {
      const report = runReport(ctx, parse(reportFilterSchema, payload))
      const bytes = await reportToExcel(ctx, report)
      const path = await host.saveBytes({
        title: 'Export Excel',
        defaultName: `${report.id}.xlsx`,
        extension: 'xlsx',
        bytes,
      })
      return { path }
    },
    'reports:exportPdf': async (payload) => {
      const report = runReport(ctx, parse(reportFilterSchema, payload))
      const bytes = await reportToPdf(ctx, report)
      const path = await host.saveBytes({ title: 'Export PDF', defaultName: `${report.id}.pdf`, extension: 'pdf', bytes })
      return { path }
    },
    'monthEnd:list': () => listMonthEnds(ctx),
    'monthEnd:get': (payload) => getMonthEnd(ctx, parse(periodSchema, payload).periodKey),
    'monthEnd:ensure': () => ensureMonthEnd(ctx),
    'notifications:list': (payload) => listNotifications(ctx, parse(notificationListSchema, payload)),
    'notifications:markRead': (payload) => markNotificationRead(ctx, parse(notificationReadSchema, payload).id),
    'notifications:markAllRead': () => markAllNotificationsRead(ctx),
    'notifications:unreadCount': () => ({ count: unreadCount(ctx) }),
    'settings:get': () => getSettings(ctx),
    'settings:update': (payload) => {
      updateSettings(ctx, parse(settingsUpdateSchema, payload))
      return getSettings(ctx)
    },
    'settings:updateCompany': (payload) => {
      updateCompany(ctx, parse(companySchema, payload))
      return getSettings(ctx)
    },
    'settings:chooseLogo': async () => {
      const file = await host.chooseLogo()
      if (!file) return getSettings(ctx)
      saveLogo(ctx, file)
      return getSettings(ctx)
    },
    'settings:addSize': (payload) => {
      addCylinderSize(ctx, parse(sizeCreateSchema, payload))
      return getSettings(ctx)
    },
    'settings:updateSize': (payload) => {
      updateCylinderSize(ctx, parse(sizeUpdateSchema, payload))
      return getSettings(ctx)
    },
    'settings:deleteSize': (payload) => {
      deleteCylinderSize(ctx, parse(idSchema, payload).id)
      return getSettings(ctx)
    },
    'settings:deleteAllData': (payload) => {
      const input = parse(deleteAllDataSchema, payload)
      if (input.confirmation !== 'DELETE ALL DATA') throw new BusinessError('Type DELETE ALL DATA to confirm.')
      return purgeOperationalData(ctx)
    },
    'routes:list': () => listRoutes(ctx),
    'routes:create': (payload) => createRoute(ctx, parse(routeCreateSchema, payload)),
    'routes:update': (payload) => updateRoute(ctx, parse(routeUpdateSchema, payload)),
    'routes:delete': (payload) => deleteRoute(ctx, parse(idSchema, payload).id),
    'routes:detail': (payload) => routeDetail(ctx, parse(routeDetailSchema, payload)),
    'search:global': (payload) => globalSearch(ctx, parse(searchSchema, payload).query),
    'backup:list': () => listBackups(ctx),
    'backup:create': async () => createBackup(ctx, defaultBackupDir(ctx), 'manual', 'Manual backup'),
    'backup:chooseDirectory': async () => {
      const directory = await host.pickDirectory('Choose backup folder')
      if (!directory) return { directory: defaultBackupDir(ctx) }
      setBackupDirectory(ctx, directory)
      return { directory }
    },
    'backup:restore': (payload) => {
      const input = parse(restoreSchema, payload)
      if (input.confirmation !== 'RESTORE') throw new BusinessError('Type RESTORE to confirm.')
      const backup = listBackups(ctx).find((item) => item.id === input.id)
      if (!backup) throw new BusinessError('Backup not found.')
      restoreFromFile(ctx, backup.filePath)
      return { restored: true }
    },
    'backup:restoreFile': async (payload) => {
      const input = parse(restoreSchema.pick({ confirmation: true }), payload ?? {})
      if (input.confirmation !== 'RESTORE') throw new BusinessError('Type RESTORE to confirm.')
      const file = await host.pickOpenFile('Choose a CylinderFlow backup', ['db'])
      if (!file) return { restored: false }
      restoreFromFile(ctx, file)
      return { restored: true }
    },
    'backup:integrity': () => integrityCheck(ctx),
    'audit:list': (payload) => listAudit(ctx, parse(auditListSchema, payload)),
    'demo:load': () => loadDemoData(ctx),
    'demo:purge': () => purgeDemoData(ctx),
    'consistency:check': () => {
      const problems = consistencyProblems(ctx.db)
      return { ok: problems.length === 0, problems }
    },
  }
}
