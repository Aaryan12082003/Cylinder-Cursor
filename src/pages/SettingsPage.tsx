import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Page, Select, Switch, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import type { AppSettings } from '@shared/types'

export function SettingsPage() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [size, setSize] = useState({ code: '', name: '', capacityLitres: '47' })
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
          <Field label="Overdue holding period (days)"><Input type="number" value={draft.overdueThresholdDays} onChange={(event) => patch({ overdueThresholdDays: Number(event.target.value) })} /></Field>
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
                <Button size="sm" variant="ghost" onClick={() => api.updateSize({ ...item, isActive: !item.isActive }).then(() => qc.invalidateQueries()).catch((error: Error) => toast.error(error.message))}>{item.isActive ? 'Deactivate' : 'Activate'}</Button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Input placeholder="Code" value={size.code} onChange={(event) => setSize({ ...size, code: event.target.value })} />
            <Input placeholder="Name" value={size.name} onChange={(event) => setSize({ ...size, name: event.target.value })} />
            <Input placeholder="Litres" value={size.capacityLitres} onChange={(event) => setSize({ ...size, capacityLitres: event.target.value })} />
          </div>
          <Button className="mt-3" variant="secondary" onClick={() => api.addSize({ code: size.code, name: size.name, capacityLitres: Number(size.capacityLitres) }).then(() => { toast.success('Size added'); setSize({ code: '', name: '', capacityLitres: '' }); qc.invalidateQueries() }).catch((error: Error) => toast.error(error.message))}>Add size</Button>
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
      </div>
    </Page>
  )
}
