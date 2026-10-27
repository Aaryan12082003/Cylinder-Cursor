import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, ConfirmDialog, Dialog, DialogContent, Field, Input, Page, Select, Switch, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import type { AppSettings } from '@shared/types'

export function SettingsPage() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [size, setSize] = useState({ code: '', name: '', capacityLitres: '47' })
  const [deleteTarget, setDeleteTarget] = useState<AppSettings['sizes'][number] | null>(null)
  const [editTarget, setEditTarget] = useState<AppSettings['sizes'][number] | null>(null)
  const [routeName, setRouteName] = useState('')
  const [routeTarget, setRouteTarget] = useState<AppSettings['routes'][number] | null>(null)
  const [routeEdit, setRouteEdit] = useState<AppSettings['routes'][number] | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState('')
  const [serialSizeId, setSerialSizeId] = useState('')
  const [serialInput, setSerialInput] = useState('')
  const serials = useQuery({ queryKey: ['cylinders', serialSizeId], queryFn: () => api.cylinders({ page: 1, pageSize: 100, sizeId: serialSizeId ? Number(serialSizeId) : undefined }), enabled: Boolean(draft) })
  useEffect(() => {
    if (query.data) setDraft(query.data)
  }, [query.data])
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return
      await api.updateCompany(draft.company)
      await api.updateSettings({
        overdueThresholdDays: draft.overdueThresholdDays,
        dateFormat: draft.dateFormat,
        currency: draft.currency,
        theme: draft.theme,
        autoBackup: draft.autoBackup,
        backupRetention: draft.backupRetention,
        backupDirectory: draft.backupDirectory,
        notifyMonthEnd: draft.notifyMonthEnd,
        notifyNative: draft.notifyNative,
        operatorName: draft.operatorName,
      })
    },
    onSuccess: () => {
      toast.success('Settings saved')
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const removeSize = useMutation({
    mutationFn: (id: number) => api.deleteSize(id),
    onSuccess: () => {
      toast.success('Cylinder size deleted')
      setDeleteTarget(null)
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const editSize = useMutation({
    mutationFn: (input: AppSettings['sizes'][number]) => api.updateSize(input),
    onSuccess: () => {
      toast.success('Cylinder size updated')
      setEditTarget(null)
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const removeRoute = useMutation({
    mutationFn: (id: number) => api.deleteRoute(id),
    onSuccess: () => { toast.success('Route deleted'); setRouteTarget(null); qc.invalidateQueries() },
    onError: (error: Error) => toast.error(error.message),
  })
  const addRoute = useMutation({
    mutationFn: (name: string) => api.createRoute({ name }),
    onSuccess: (route) => {
      toast.success('Route added')
      setRouteName('')
      setDraft((current) => current ? { ...current, routes: [...current.routes, route].sort((a, b) => a.name.localeCompare(b.name)) } : current)
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const deleteAll = useMutation({
    mutationFn: (confirmation: string) => api.deleteAllData(confirmation),
    onSuccess: (result) => {
      toast.success(result.backupCleanupIncomplete ? 'All operational data deleted; some backup files could not be removed.' : 'All operational data deleted')
      setDeleteAllOpen(false)
      setDeleteAllConfirmation('')
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  if (!draft) return <Page title="Settings" subtitle="Loading company preferences…" />
  const patch = (partial: Partial<AppSettings>) => setDraft({ ...draft, ...partial })
  return (
    <Page title="Settings" subtitle="Company identity, cylinder sizes, reminders, and how dates are shown." actions={<Button onClick={() => save.mutate()} disabled={save.isPending}>Save settings</Button>}>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold">Company</h2>
          <Field label="Name"><Input value={draft.company.name} onChange={(event) => patch({ company: { ...draft.company, name: event.target.value } })} /></Field>
          <Field label="Address"><Textarea value={draft.company.address} onChange={(event) => patch({ company: { ...draft.company, address: event.target.value } })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GSTIN"><Input value={draft.company.gstNumber} onChange={(event) => patch({ company: { ...draft.company, gstNumber: event.target.value } })} /></Field>
            <Field label="Phone"><Input value={draft.company.phone} onChange={(event) => patch({ company: { ...draft.company, phone: event.target.value } })} /></Field>
          </div>
          <Field label="Email"><Input value={draft.company.email} onChange={(event) => patch({ company: { ...draft.company, email: event.target.value } })} /></Field>
          <div className="flex items-center gap-3">
            {draft.company.logoDataUrl ? <img src={draft.company.logoDataUrl} alt="Company logo" className="h-12 w-12 rounded-lg border border-border object-contain" /> : null}
            <Button variant="secondary" onClick={() => api.chooseLogo().then(() => qc.invalidateQueries()).catch((error: Error) => toast.error(error.message))}>Choose logo</Button>
          </div>
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold">Preferences</h2>
          <Field label="Operator name"><Input value={draft.operatorName} onChange={(event) => patch({ operatorName: event.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date format">
              <Select value={draft.dateFormat} onChange={(event) => patch({ dateFormat: event.target.value })}>
                <option value="dd MMM yyyy">22 Oct 2026</option>
                <option value="dd/MM/yyyy">22/10/2026</option>
                <option value="dd MMMM yyyy">22 October 2026</option>
                <option value="yyyy-MM-dd">2026-10-22</option>
              </Select>
            </Field>
            <Field label="Currency display">
              <Select value={draft.currency} onChange={(event) => patch({ currency: event.target.value })}>
                <option value="INR">INR ₹</option>
                <option value="USD">USD $</option>
                <option value="EUR">EUR €</option>
              </Select>
            </Field>
          </div>
          <Field label="Notify when a party holds cylinders for">
            <Select value={String(draft.overdueThresholdDays)} onChange={(event) => patch({ overdueThresholdDays: Number(event.target.value) })}>
              {[2, 5, 7, 14, 30].map((days) => <option key={days} value={days}>{days} days</option>)}
              {[2, 5, 7, 14, 30].includes(draft.overdueThresholdDays) ? null : <option value={draft.overdueThresholdDays}>{draft.overdueThresholdDays} days (current)</option>}
            </Select>
          </Field>
          <Field label="Backup retention"><Input type="number" value={draft.backupRetention} onChange={(event) => patch({ backupRetention: Number(event.target.value) })} /></Field>
          <div className="flex items-center justify-between text-sm"><span>Theme</span><Button variant="secondary" onClick={() => patch({ theme: draft.theme === 'dark' ? 'light' : 'dark' })}>{draft.theme === 'dark' ? 'Dark' : 'Light'}</Button></div>
          <div className="flex items-center justify-between text-sm"><span>Automatic backup on launch</span><Switch checked={draft.autoBackup} onCheckedChange={(autoBackup) => patch({ autoBackup })} /></div>
          <div className="flex items-center justify-between text-sm"><span>Month-end in-app alerts</span><Switch checked={draft.notifyMonthEnd} onCheckedChange={(notifyMonthEnd) => patch({ notifyMonthEnd })} /></div>
          <div className="flex items-center justify-between text-sm"><span>Native notification while open</span><Switch checked={draft.notifyNative} onCheckedChange={(notifyNative) => patch({ notifyNative })} /></div>
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold">Cylinder sizes</h2>
          <p className="mt-1 text-sm text-muted">3 Litre, 10 Litre, and 23 Litre are ready. Add more without changing the application.</p>
          <div className="mt-3 divide-y divide-border">
            {draft.sizes.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                <span>{item.name} <span className="text-muted">{item.code}</span></span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditTarget(item)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => api.updateSize({ ...item, isActive: !item.isActive }).then(() => qc.invalidateQueries()).catch((error: Error) => toast.error(error.message))}>{item.isActive ? 'Deactivate' : 'Activate'}</Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteTarget(item)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Edit any size. Permanent deletion removes all stock, serial, and transaction data for that size and recalculates balances. Use it only to remove a mistaken size.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Input placeholder="Code" value={size.code} onChange={(event) => setSize({ ...size, code: event.target.value })} />
            <Input placeholder="Name" value={size.name} onChange={(event) => setSize({ ...size, name: event.target.value })} />
            <Input placeholder="Litres" value={size.capacityLitres} onChange={(event) => setSize({ ...size, capacityLitres: event.target.value })} />
          </div>
          <Button className="mt-3" variant="secondary" onClick={() => api.addSize({ code: size.code, name: size.name, capacityLitres: Number(size.capacityLitres) }).then(() => { toast.success('Size added'); setSize({ code: '', name: '', capacityLitres: '' }); qc.invalidateQueries() }).catch((error: Error) => toast.error(error.message))}>Add size</Button>
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold">Route master</h2>
          <p className="mt-1 text-sm text-muted">Create routes such as Jaipur or Udaipur. Customers are assigned automatically when their city matches a route, and you can change a customer’s route from their profile.</p>
          <div className="mt-3 divide-y divide-border">
            {draft.routes.map((route) => <div key={route.id} className="flex items-center justify-between py-2 text-sm">
              <span>{route.name}{route.isActive ? null : <span className="ml-2 text-xs text-muted">Inactive</span>}</span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setRouteEdit(route)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => api.updateRoute({ ...route, isActive: !route.isActive }).then(() => qc.invalidateQueries()).catch((error: Error) => toast.error(error.message))}>{route.isActive ? 'Deactivate' : 'Activate'}</Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRouteTarget(route)}>Delete</Button>
              </div>
            </div>)}
            {draft.routes.length === 0 ? <p className="py-2 text-sm text-muted">No routes created yet.</p> : null}
          </div>
          <div className="mt-3 flex gap-2"><Input placeholder="Route name" value={routeName} onChange={(event) => setRouteName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && routeName.trim().length >= 2) addRoute.mutate(routeName.trim()) }} /><Button type="button" variant="secondary" disabled={routeName.trim().length < 2 || addRoute.isPending} onClick={() => addRoute.mutate(routeName.trim())}>{addRoute.isPending ? 'Adding…' : 'Add route'}</Button></div>
        </Card>
        <Card className="p-5 xl:col-span-2">
          <h2 className="text-base font-semibold">Serial-numbered cylinders</h2>
          <p className="mt-1 text-sm text-muted">Register individual cylinder serial numbers. Dispatch and return screens accept one serial per line when you want item-level tracking; quantity-only entries remain supported.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr_auto]">
            <Select value={serialSizeId} onChange={(event) => setSerialSizeId(event.target.value)}>
              <option value="">Choose cylinder size</option>
              {draft.sizes.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Textarea value={serialInput} onChange={(event) => setSerialInput(event.target.value)} placeholder="Enter serial numbers, one per line" className="min-h-16" />
            <Button disabled={!serialSizeId || !serialInput.trim()} onClick={() => api.registerCylinders({ sizeId: Number(serialSizeId), serialNumbers: serialInput.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean) }).then((result) => { toast.success(`${result.registered} serial number${result.registered === 1 ? '' : 's'} registered`); setSerialInput(''); serials.refetch() }).catch((error: Error) => toast.error(error.message))}>Register</Button>
          </div>
          {serials.data ? <div className="mt-4 overflow-auto"><table className="w-full text-left text-[13px]"><thead className="text-xs uppercase tracking-wide text-muted"><tr>{['Serial number', 'Size', 'Status', 'Party'].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{serials.data.rows.map((item) => <tr key={item.id} className="border-t border-border"><td className="px-3 py-2 font-medium">{item.serialNumber}</td><td className="px-3 py-2">{item.sizeName}</td><td className="px-3 py-2">{item.status.replaceAll('_', ' ')}</td><td className="px-3 py-2">{item.customerName || '—'}</td></tr>)}</tbody></table></div> : null}
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold">Data</h2>
          <p className="text-sm text-muted">Demonstration customers are optional and labelled. They are never created on a database that already has records.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => api.loadDemo().then(() => { toast.success('Demonstration data loaded'); qc.invalidateQueries() }).catch((error: Error) => toast.error(error.message))}>Load demonstration data</Button>
            <Button variant="secondary" onClick={() => api.purgeDemo().then(() => { toast.success('Demonstration data removed'); qc.invalidateQueries() }).catch((error: Error) => toast.error(error.message))}>Remove demonstration data</Button>
            <Button variant="secondary" onClick={() => api.consistency().then((result) => result.ok ? toast.success('Inventory is consistent') : toast.error(result.problems[0] ?? 'Inconsistent')).catch((error: Error) => toast.error(error.message))}>Check consistency</Button>
          </div>
          <p className="text-xs text-muted">Installed {draft.installedOn ? new Date(draft.installedOn).toLocaleString() : '—'}. Records stay in the Windows application data folder and survive updates.</p>
        </Card>
        <Card className="space-y-3 border-red-200 bg-red-50/40 p-5 xl:col-span-2">
          <div>
            <h2 className="text-base font-semibold text-red-800">Delete all operational data</h2>
            <p className="mt-1 text-sm text-red-700">Permanently removes all customers, inventory, dispatches, returns, balances, and operational history from this application. This cannot be undone.</p>
          </div>
          <div>
            <Button variant="danger" onClick={() => setDeleteAllOpen(true)} disabled={deleteAll.isPending}>Delete all operational data</Button>
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete cylinder size permanently?"
        body={deleteTarget ? `${deleteTarget.name} (${deleteTarget.code}) and all stock, serial numbers, movements, and transaction data for this size will be permanently deleted. Customer balances and inventory will be recalculated. This cannot be undone.` : ''}
        confirmLabel={removeSize.isPending ? 'Deleting…' : 'Delete permanently'}
        disabled={removeSize.isPending}
        danger
        onConfirm={() => { if (deleteTarget) removeSize.mutate(deleteTarget.id) }}
      />
      <ConfirmDialog open={Boolean(routeTarget)} onOpenChange={(open) => { if (!open) setRouteTarget(null) }} title="Delete route?" body={routeTarget ? `${routeTarget.name} will be removed if it has no transaction history. Historical routes can be deactivated instead.` : ''} confirmLabel="Delete route" danger onConfirm={() => { if (routeTarget) removeRoute.mutate(routeTarget.id) }} disabled={removeRoute.isPending} />
      <Dialog open={Boolean(routeEdit)} onOpenChange={(open) => { if (!open) setRouteEdit(null) }}><DialogContent title="Edit route" description="Rename a route or change its active status.">{routeEdit ? <div className="space-y-3"><Field label="Route name"><Input value={routeEdit.name} onChange={(event) => setRouteEdit({ ...routeEdit, name: event.target.value })} /></Field><div className="flex justify-end"><Button onClick={() => api.updateRoute(routeEdit).then(() => { toast.success('Route updated'); setRouteEdit(null); qc.invalidateQueries() }).catch((error: Error) => toast.error(error.message))}>Save changes</Button></div></div> : null}</DialogContent></Dialog>
      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent title="Edit cylinder size" description="Update the label and capacity used throughout the application.">
          {editTarget ? <div className="space-y-3">
            <Field label="Code"><Input value={editTarget.code} onChange={(event) => setEditTarget({ ...editTarget, code: event.target.value })} /></Field>
            <Field label="Name"><Input value={editTarget.name} onChange={(event) => setEditTarget({ ...editTarget, name: event.target.value })} /></Field>
            <Field label="Capacity (litres)"><Input type="number" value={editTarget.capacityLitres} onChange={(event) => setEditTarget({ ...editTarget, capacityLitres: Number(event.target.value) })} /></Field>
            <div className="flex justify-end"><Button disabled={editSize.isPending} onClick={() => editSize.mutate(editTarget)}>{editSize.isPending ? 'Saving…' : 'Save changes'}</Button></div>
          </div> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={deleteAllOpen} onOpenChange={(open) => { if (!open && !deleteAll.isPending) { setDeleteAllOpen(false); setDeleteAllConfirmation('') } }}>
        <DialogContent title="Delete all operational data?" description="This is a permanent, destructive action. Review the warning carefully before continuing." className="max-w-lg">
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">Everything operational will be erased.</p>
              <p className="mt-1">Customers, cylinder records, inventory movements, dispatches, returns, balances, and related history will be permanently deleted. Do this only after creating a backup if you may need the records later.</p>
            </div>
            <Field label="Type DELETE ALL DATA to confirm">
              <Input
                value={deleteAllConfirmation}
                onChange={(event) => setDeleteAllConfirmation(event.target.value)}
                placeholder="DELETE ALL DATA"
                autoComplete="off"
                spellCheck={false}
                disabled={deleteAll.isPending}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setDeleteAllOpen(false); setDeleteAllConfirmation('') }} disabled={deleteAll.isPending}>Cancel</Button>
              <Button variant="danger" onClick={() => deleteAll.mutate(deleteAllConfirmation)} disabled={deleteAll.isPending || deleteAllConfirmation !== 'DELETE ALL DATA'}>{deleteAll.isPending ? 'Deleting…' : 'Delete everything permanently'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
