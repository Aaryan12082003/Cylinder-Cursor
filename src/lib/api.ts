import type {
  AppNotification,
  AppSettings,
  AuditRow,
  BackupRecord,
  CustomerRow,
  DashboardData,
  DispatchRow,
  LedgerRow,
  MonthEndReport,
  MovementRow,
  OutstandingRow,
  Page,
  ReportModel,
  ReturnRow,
  SavedFile,
  SearchHit,
  SizeBalance,
} from '@shared/types'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const result = window.cylinderflow
    ? ((await window.cylinderflow.invoke(channel, payload)) as Result<T>)
    : await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, payload }),
      }).then((response) => response.json() as Promise<Result<T>>)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export const api = {
  dashboard: () => call<DashboardData>('dashboard:get'),
  inventory: () => call<{ sizes: SizeBalance[] }>('inventory:overview'),
  setOpening: (payload: unknown) => call<{ sizes: SizeBalance[] }>('inventory:setOpening', payload),
  adjust: (payload: unknown) => call<{ number: string }>('inventory:adjust', payload),
  movements: (payload: unknown) => call<Page<MovementRow>>('inventory:movements', payload),
  customers: (payload: unknown) => call<Page<CustomerRow>>('customers:list', payload),
  customer: (id: number) => call<CustomerRow>('customers:get', { id }),
  createCustomer: (payload: unknown) => call<CustomerRow>('customers:create', payload),
  updateCustomer: (payload: unknown) => call<CustomerRow>('customers:update', payload),
  archiveCustomer: (id: number, archived = true) => call<CustomerRow>('customers:archive', { id, archived }),
  deleteCustomer: (id: number) => call<{ deleted: true }>('customers:delete', { id }),
  reconcile: (payload: unknown) => call<{ number: string }>('customers:reconcile', payload),
  dispatches: (payload: unknown) => call<Page<DispatchRow>>('dispatch:list', payload),
  dispatch: (id: number) => call<DispatchRow>('dispatch:get', { id }),
  createDispatch: (payload: unknown) => call<DispatchRow>('dispatch:create', payload),
  reverseDispatch: (id: number, reason: string) => call<DispatchRow>('dispatch:reverse', { id, reason }),
  challan: (id: number) => call<SavedFile>('dispatch:challan', { id }),
  returns: (payload: unknown) => call<Page<ReturnRow>>('returns:list', payload),
  createReturn: (payload: unknown) => call<ReturnRow>('returns:create', payload),
  reverseReturn: (id: number, reason: string) => call<ReturnRow>('returns:reverse', { id, reason }),
  ledger: (payload: unknown) =>
    call<Page<LedgerRow> & { summary: { dispatched: number; returned: number; adjustment: number; opening: number | null; closing: number | null } }>(
      'ledger:list',
      payload,
    ),
  outstanding: (payload: unknown) => call<Page<OutstandingRow>>('outstanding:list', payload),
  reportCatalog: () => call<{ id: string; title: string; description: string }[]>('reports:catalog'),
  runReport: (payload: unknown) => call<ReportModel>('reports:run', payload),
  exportExcel: (payload: unknown) => call<SavedFile>('reports:exportExcel', payload),
  exportPdf: (payload: unknown) => call<SavedFile>('reports:exportPdf', payload),
  monthEnds: () => call<Omit<MonthEndReport, 'items'>[]>('monthEnd:list'),
  monthEnd: (periodKey: string) => call<MonthEndReport>('monthEnd:get', { periodKey }),
  notifications: (payload: unknown) => call<Page<AppNotification>>('notifications:list', payload),
  markRead: (id: number) => call<AppNotification>('notifications:markRead', { id }),
  markAllRead: () => call<{ unread: number }>('notifications:markAllRead'),
  unreadCount: () => call<{ count: number }>('notifications:unreadCount'),
  settings: () => call<AppSettings>('settings:get'),
  updateSettings: (payload: unknown) => call<AppSettings>('settings:update', payload),
  updateCompany: (payload: unknown) => call<AppSettings>('settings:updateCompany', payload),
  chooseLogo: () => call<AppSettings>('settings:chooseLogo'),
  addSize: (payload: unknown) => call<AppSettings>('settings:addSize', payload),
  updateSize: (payload: unknown) => call<AppSettings>('settings:updateSize', payload),
  deleteSize: (id: number) => call<{ deleted: true }>('settings:deleteSize', { id }),
  search: (query: string) => call<SearchHit[]>('search:global', { query }),
  backups: () => call<BackupRecord[]>('backup:list'),
  createBackup: () => call<BackupRecord>('backup:create'),
  chooseBackupDir: () => call<{ directory: string }>('backup:chooseDirectory'),
  restoreBackup: (id: number, confirmation: string) => call<{ restored: boolean }>('backup:restore', { id, confirmation }),
  restoreFile: (confirmation: string) => call<{ restored: boolean }>('backup:restoreFile', { confirmation }),
  integrity: () => call<{ ok: boolean; message: string }>('backup:integrity'),
  audit: (payload: unknown) => call<Page<AuditRow>>('audit:list', payload),
  loadDemo: () => call<{ loaded: boolean }>('demo:load'),
  purgeDemo: () => call<{ purged: boolean }>('demo:purge'),
  consistency: () => call<{ ok: boolean; problems: string[] }>('consistency:check'),
}

export function onAppEvent(callback: (data: { type?: string }) => void) {
  if (!window.cylinderflow) return () => undefined
  return window.cylinderflow.on('app-event', (data) => callback(data as { type?: string }))
}
