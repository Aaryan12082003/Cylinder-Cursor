import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCount, formatDateOnly, todayIso } from '@shared/dates'
import { Plus, Trash2, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, Input, Page, Pagination, Select, Textarea } from '@/components/ui'
import { api } from '@/lib/api'

type Line = { sizeId: string; quantity: string; condition: 'filled' | 'empty'; serialNumbers: string }

export function DispatchPage() {
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const customers = useQuery({ queryKey: ['customers', 'options'], queryFn: () => api.customers({ page: 1, pageSize: 100, status: 'active', sortBy: 'partyName', sortDir: 'asc' }) })
  const [page, setPage] = useState(1)
  const history = useQuery({ queryKey: ['dispatches', page], queryFn: () => api.dispatches({ page, pageSize: 8, sortDir: 'desc' }) })
  const [form, setForm] = useState({
    date: todayIso(),
    customerId: params.get('customer') ?? '',
    routeId: '',
    vehicleNumber: '',
    challanNumber: '',
    driverName: '',
    remarks: '',
  })
  const [routeSearch, setRouteSearch] = useState('')
  const [routeOpen, setRouteOpen] = useState(false)
  const [routeDialog, setRouteDialog] = useState(false)
  const [newRouteName, setNewRouteName] = useState('')
  const [lines, setLines] = useState<Line[]>([{ sizeId: '', quantity: '', condition: 'filled', serialNumbers: '' }])
  const [confirm, setConfirm] = useState(false)
  const [reverse, setReverse] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const sizes = settings.data?.sizes.filter((size) => size.isActive) ?? []
  const routeOptions = settings.data?.routes.filter((route) => route.isActive && route.name.toLowerCase().includes(routeSearch.trim().toLowerCase())) ?? []
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
  const payload = useMemo(() => ({
    ...form,
    customerId: Number(form.customerId),
    routeId: form.routeId ? Number(form.routeId) : null,
    lines: lines.filter((line) => line.sizeId && Number(line.quantity) > 0).map((line) => ({ sizeId: Number(line.sizeId), quantity: Number(line.quantity), condition: line.condition, serialNumbers: line.serialNumbers.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean) })),
  }), [form, lines])
  const create = useMutation({
    mutationFn: () => api.createDispatch(payload),
    onSuccess: (dispatch) => {
      toast.success(`${dispatch.number} dispatched`, { action: { label: 'Print challan', onClick: () => api.challan(dispatch.id).catch((error: Error) => toast.error(error.message)) } })
      setConfirm(false)
      setLines([{ sizeId: '', quantity: '', condition: 'filled', serialNumbers: '' }])
      setForm((current) => ({ ...current, remarks: '', challanNumber: '', vehicleNumber: '', driverName: '' }))
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const undo = useMutation({
    mutationFn: () => api.reverseDispatch(reverse!, reason),
    onSuccess: () => {
      toast.success('Dispatch reversed')
      setReverse(null)
      setReason('')
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const addRoute = useMutation({
    mutationFn: () => api.createRoute({ name: newRouteName.trim() }),
    onSuccess: (route) => {
      toast.success('Route added')
      setForm((current) => ({ ...current, routeId: String(route.id) }))
      setRouteSearch(route.name)
      setNewRouteName('')
      setRouteDialog(false)
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Page title="Dispatch cylinders" subtitle="Send one or more sizes in a single challan. Stock and customer balances update together.">
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card className="p-5">
          <h2 className="text-base font-semibold">New dispatch</h2>
          <div className="mt-4 grid gap-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
            <Field label="Customer">
              <Select value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
                <option value="">Choose customer</option>
                {customers.data?.rows.map((customer) => <option key={customer.id} value={customer.id}>{customer.partyName}</option>)}
              </Select>
            </Field>
            <Field label="Route (optional)">
              <div className="relative flex gap-2">
                <Input role="combobox" aria-expanded={routeOpen} aria-controls="dispatch-route-options" placeholder="Search or choose route" value={routeSearch} onFocus={() => setRouteOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') setRouteOpen(false) }} onChange={(event) => {
                  const value = event.target.value
                  const match = settings.data?.routes.find((route) => route.isActive && route.name.toLowerCase() === value.trim().toLowerCase())
                  setRouteSearch(value)
                  setForm({ ...form, routeId: match ? String(match.id) : '' })
                }} />
                <Button type="button" variant="secondary" onClick={() => { setNewRouteName(routeSearch.trim()); setRouteDialog(true) }}>Add route</Button>
                {routeOpen ? <div id="dispatch-route-options" role="listbox" className="absolute left-0 top-11 z-20 max-h-52 w-[calc(100%-92px)] overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
                  <button type="button" role="option" aria-selected={!form.routeId} className="block w-full rounded px-3 py-2 text-left text-sm text-muted hover:bg-background" onMouseDown={(event) => event.preventDefault()} onClick={() => { setForm({ ...form, routeId: '' }); setRouteSearch(''); setRouteOpen(false) }}>No route</button>
                  {routeOptions.map((route) => <button type="button" role="option" aria-selected={form.routeId === String(route.id)} key={route.id} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-background" onMouseDown={(event) => event.preventDefault()} onClick={() => { setForm({ ...form, routeId: String(route.id) }); setRouteSearch(route.name); setRouteOpen(false) }}>{route.name}</button>)}
                  {routeOptions.length === 0 ? <div className="px-3 py-2 text-sm text-muted">No matching routes</div> : null}
                </div> : null}
              </div>
            </Field>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-[1fr_88px_32px] gap-2">
                  <Select value={line.sizeId} onChange={(event) => updateLine(setLines, index, { sizeId: event.target.value })}>
                    <option value="">Size</option>
                    {sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
                  </Select>
                  <Input value={line.quantity} placeholder="Qty" inputMode="numeric" onChange={(event) => updateLine(setLines, index, { quantity: event.target.value })} />
                  <button className="text-muted" onClick={() => setLines(lines.filter((_, item) => item !== index))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></button>
                  <Textarea className="col-span-3 min-h-16" value={line.serialNumbers} placeholder="Serial numbers (optional, one per line)" onChange={(event) => updateLine(setLines, index, { serialNumbers: event.target.value })} />
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { sizeId: '', quantity: '', condition: 'filled', serialNumbers: '' }])}><Plus className="h-4 w-4" /> Add size</Button>
            </div>
            <Field label="Vehicle number"><Input value={form.vehicleNumber} onChange={(event) => setForm({ ...form, vehicleNumber: event.target.value })} /></Field>
            <Field label="Delivery challan number"><Input value={form.challanNumber} onChange={(event) => setForm({ ...form, challanNumber: event.target.value })} /></Field>
            <Field label="Driver name"><Input value={form.driverName} onChange={(event) => setForm({ ...form, driverName: event.target.value })} /></Field>
            <Field label="Remarks"><Textarea value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} /></Field>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Total {formatCount(total)}</span>
              <Button onClick={() => setConfirm(true)} disabled={!payload.customerId || payload.lines.length === 0}>Review dispatch</Button>
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3"><div className="text-sm font-semibold">Recent dispatches</div><p className="mt-1 text-xs text-muted">Made a mistake? Use “Undo mistake” to reverse a posted dispatch while keeping the audit history.</p></div>
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>{['Number', 'Date', 'Customer', 'Qty', 'Status', ''].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr>
            </thead>
            <tbody>
              {history.data?.rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{row.number}</td>
                  <td className="px-4 py-3">{formatDateOnly(row.date)}</td>
                  <td className="px-4 py-3">{row.partyName}{row.routeName ? <div className="text-xs text-muted">{row.routeName}</div> : null}</td>
                  <td className="px-4 py-3">{row.totalQuantity}</td>
                  <td className="px-4 py-3">{row.reversedAt ? <Badge tone="warning">Reversed</Badge> : <Badge tone="success">Posted</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => api.challan(row.id).catch((error: Error) => toast.error(error.message))}>Challan</Button>
                    {row.reversedAt ? null : <Button size="sm" variant="ghost" onClick={() => setReverse(row.id)}>Undo mistake</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data && history.data.total === 0 ? <EmptyState icon={<Truck className="h-5 w-5" />} title="No dispatches yet" body="The first challan will appear here after you confirm a dispatch." /> : null}
          <Pagination page={page} pageSize={8} total={history.data?.total ?? 0} onPage={setPage} />
        </Card>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Confirm dispatch"
        body={`${customers.data?.rows.find((item) => item.id === payload.customerId)?.partyName ?? 'Customer'} will receive ${total} cylinders. Available stock is checked before anything is saved.`}
        confirmLabel={create.isPending ? 'Saving…' : 'Dispatch'}
        onConfirm={() => create.mutate()}
      />
      <Dialog open={reverse !== null} onOpenChange={(open) => { if (!open) setReverse(null) }}>
        <DialogContent title="Undo mistaken dispatch" description="The original document stays in history. This creates a reversal and restores stock only if the customer still holds those cylinders." className="max-w-md">
          <Field label="Reason"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <div className="mt-4 flex justify-end"><Button variant="danger" onClick={() => undo.mutate()} disabled={reason.trim().length < 5}>Undo dispatch</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={routeDialog} onOpenChange={(open) => { if (!open && !addRoute.isPending) setRouteDialog(false) }}>
        <DialogContent title="Add route" description="Create a route and use it for this dispatch.">
          <Field label="Route name"><Input autoFocus value={newRouteName} onChange={(event) => setNewRouteName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && newRouteName.trim().length >= 2) addRoute.mutate() }} placeholder="e.g. Jaipur" /></Field>
          <div className="mt-4 flex justify-end"><Button type="button" onClick={() => addRoute.mutate()} disabled={addRoute.isPending || newRouteName.trim().length < 2}>{addRoute.isPending ? 'Adding…' : 'Add and select'}</Button></div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function updateLine(setLines: (value: Line[] | ((current: Line[]) => Line[])) => void, index: number, patch: Partial<Line>) {
  setLines((current) => current.map((line, item) => (item === index ? { ...line, ...patch } : line)))
}
