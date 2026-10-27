import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCount, formatDateOnly, todayIso } from '@shared/dates'
import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, Input, Page, Pagination, Select, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import type { ReturnRow } from '@shared/types'

type Line = { sizeId: string; quantity: string; condition: 'filled' | 'empty' | 'damaged' | 'lost' | 'maintenance'; serialNumbers: string }
type CustomerRouteFields = { routeId?: number | null; routeName?: string }
type ActiveRouteOption = { id: number; name: string; isActive: boolean }

function activeCustomerRoute(customer: CustomerRouteFields | undefined, routes: ActiveRouteOption[] | undefined) {
  if (customer?.routeId == null) return null
  const route = routes?.find((item) => item.id === customer.routeId)
  return route?.isActive ? route.id : null
}

export function ReturnsPage() {
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const customers = useQuery({ queryKey: ['customers', 'all-open'], queryFn: () => api.customers({ page: 1, pageSize: 100, status: 'all', sortBy: 'partyName', sortDir: 'asc' }) })
  const [page, setPage] = useState(1)
  const history = useQuery({ queryKey: ['returns', page], queryFn: () => api.returns({ page, pageSize: 8, sortDir: 'desc' }) })
  const [form, setForm] = useState({ date: todayIso(), customerId: params.get('customer') ?? '', routeId: '', challanReference: '', remarks: '', allowReconciliation: false, reconciliationReason: '' })
  const [lines, setLines] = useState<Line[]>([{ sizeId: '', quantity: '', condition: 'empty', serialNumbers: '' }])
  const [confirm, setConfirm] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [routeOverride, setRouteOverride] = useState(false)
  const [reverse, setReverse] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const sizes = settings.data?.sizes.filter((size) => size.isActive) ?? []
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
  const selectedCustomer = customers.data?.rows.find((customer) => String(customer.id) === form.customerId)
  const payload = useMemo(() => ({
    ...form,
    customerId: Number(form.customerId),
    routeId: form.routeId ? Number(form.routeId) : null,
    lines: lines.filter((line) => line.sizeId && Number(line.quantity) > 0).map((line) => ({ sizeId: Number(line.sizeId), quantity: Number(line.quantity), condition: line.condition, serialNumbers: line.serialNumbers.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean) })),
  }), [form, lines])
  const create = useMutation({
    mutationFn: () => api.createReturn(payload),
    onSuccess: (entry) => {
      toast.success(`${entry.number} received`)
      setConfirm(false)
      setRouteOverride(false)
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const update = useMutation({
    mutationFn: () => api.updateReturn({ ...payload, id: editing }),
    onSuccess: (entry) => {
      toast.success(`${entry.number} updated`)
      setConfirm(false)
      setEditing(null)
      resetReturnForm(setForm, setLines, setRouteOverride)
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const undo = useMutation({
    mutationFn: () => api.reverseReturn(reverse!, reason),
    onSuccess: () => {
      toast.success('Return reversed')
      setReverse(null)
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  useEffect(() => {
    if (editing !== null || routeOverride || !form.customerId) return
    const customer = selectedCustomer as (CustomerRouteFields & { id: number }) | undefined
    const customerRouteId = activeCustomerRoute(customer, settings.data?.routes)
    const nextRouteId = customerRouteId == null ? '' : String(customerRouteId)
    if (form.routeId !== nextRouteId) setForm((current) => ({ ...current, routeId: nextRouteId }))
  }, [editing, form.customerId, form.routeId, routeOverride, selectedCustomer, settings.data?.routes])
  return (
    <Page title="Receive cylinders" subtitle="Partial and mixed returns are supported. A customer cannot return more than their outstanding balance unless you authorize a reconciliation.">
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{editing ? 'Edit return' : 'New return'}</h2>{editing ? <Button size="sm" variant="ghost" onClick={() => { setEditing(null); resetReturnForm(setForm, setLines, setRouteOverride) }}>Cancel</Button> : null}</div>
          <div className="mt-4 grid gap-3">
            <Field label="Date"><Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
            <Field label="Customer">
              <Select value={form.customerId} onChange={(event) => {
                const customerId = event.target.value
                if (routeOverride) {
                  setForm({ ...form, customerId })
                  return
                }
                const customer = customers.data?.rows.find((item) => String(item.id) === customerId) as (CustomerRouteFields & { id: number }) | undefined
                const customerRouteId = activeCustomerRoute(customer, settings.data?.routes)
                setForm({ ...form, customerId, routeId: customerRouteId == null ? '' : String(customerRouteId) })
              }}>
                <option value="">Choose customer</option>
                {customers.data?.rows.map((customer) => <option key={customer.id} value={customer.id}>{customer.partyName}</option>)}
              </Select>
            </Field>
            <Field label="Route (optional)">
              <Select value={form.routeId} onChange={(event) => { setRouteOverride(true); setForm({ ...form, routeId: event.target.value }) }}>
                <option value="">Choose route</option>
                {settings.data?.routes.filter((route) => route.isActive || String(route.id) === form.routeId).map((route) => <option key={route.id} value={route.id}>{route.name}{route.isActive ? '' : ' (inactive)'}</option>)}
              </Select>
            </Field>
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_88px_32px] gap-2">
                <Select value={line.sizeId} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, sizeId: event.target.value } : item))}>
                  <option value="">Size</option>
                  {sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
                </Select>
                <Input value={line.quantity} inputMode="numeric" placeholder="Qty" onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />
                <button className="text-muted" aria-label="Remove line" onClick={() => setLines(lines.filter((_, item) => item !== index))}><Trash2 className="h-4 w-4" /></button>
                <Textarea className="col-span-3 min-h-16" value={line.serialNumbers} placeholder="Serial numbers (optional, one per line)" onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, serialNumbers: event.target.value } : item))} />
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { sizeId: '', quantity: '', condition: 'empty', serialNumbers: '' }])}><Plus className="h-4 w-4" /> Add size</Button>
            <Field label="Challan reference"><Input value={form.challanReference} onChange={(event) => setForm({ ...form, challanReference: event.target.value })} /></Field>
            <Field label="Remarks"><Textarea value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.allowReconciliation} onChange={(event) => setForm({ ...form, allowReconciliation: event.target.checked })} />
              Authorized reconciliation if the count exceeds the books
            </label>
            {form.allowReconciliation ? <Field label="Reconciliation reason"><Textarea value={form.reconciliationReason} onChange={(event) => setForm({ ...form, reconciliationReason: event.target.value })} /></Field> : null}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Total {formatCount(total)}</span>
              <Button onClick={() => setConfirm(true)} disabled={!payload.customerId || payload.lines.length === 0}>{editing ? 'Review changes' : 'Review return'}</Button>
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3"><div className="text-sm font-semibold">Recent returns</div><p className="mt-1 text-xs text-muted">Made a mistake? Use “Undo mistake” to reverse a posted return while keeping the audit history.</p></div>
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs uppercase tracking-wide text-muted"><tr>{['Number', 'Date', 'Customer', 'Qty', 'Status', ''].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>
              {history.data?.rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{row.number}</td>
                  <td className="px-4 py-3">{formatDateOnly(row.date)}</td>
                  <td className="px-4 py-3">{row.partyName}{row.routeName ? <div className="text-xs text-muted">{row.routeName}</div> : null}</td>
                  <td className="px-4 py-3">{row.totalQuantity}</td>
                  <td className="px-4 py-3">{row.reversedAt ? <Badge tone="warning">Reversed</Badge> : <Badge tone="success">Posted</Badge>}</td>
                  <td className="px-4 py-3 text-right">{row.reversedAt ? null : <><Button size="sm" variant="ghost" onClick={() => beginEditReturn(row, setEditing, setForm, setLines, setRouteOverride)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button><Button size="sm" variant="ghost" onClick={() => setReverse(row.id)}>Undo mistake</Button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data && history.data.total === 0 ? <EmptyState icon={<Undo2 className="h-5 w-5" />} title="No returns yet" body="Received cylinders will show the condition they came back in." /> : null}
          <Pagination page={page} pageSize={8} total={history.data?.total ?? 0} onPage={setPage} />
        </Card>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={editing ? 'Confirm return changes' : 'Confirm return'} body={editing ? 'The posted document will be reversed and replaced atomically. This is allowed only while its later movements can still be safely undone.' : `Receive ${total} cylinders and update the customer balance.`} confirmLabel={(create.isPending || update.isPending) ? 'Saving…' : editing ? 'Save changes' : 'Receive'} onConfirm={() => editing ? update.mutate() : create.mutate()} />
      <Dialog open={reverse !== null} onOpenChange={(open) => { if (!open) setReverse(null) }}>
        <DialogContent title="Undo mistaken return" description="The original document stays in history. This creates a reversal and puts the cylinders back with the customer if that stock condition still has them." className="max-w-md">
          <Field label="Reason"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <div className="mt-4 flex justify-end"><Button variant="danger" onClick={() => undo.mutate()} disabled={reason.trim().length < 5}>Undo return</Button></div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function resetReturnForm(
  setForm: Dispatch<SetStateAction<{ date: string; customerId: string; routeId: string; challanReference: string; remarks: string; allowReconciliation: boolean; reconciliationReason: string }>>,
  setLines: Dispatch<SetStateAction<Line[]>>,
  setRouteOverride: Dispatch<SetStateAction<boolean>>,
) {
  setForm((current) => ({ ...current, date: todayIso(), routeId: '', challanReference: '', remarks: '', allowReconciliation: false, reconciliationReason: '' }))
  setLines([{ sizeId: '', quantity: '', condition: 'empty', serialNumbers: '' }])
  setRouteOverride(false)
}

function beginEditReturn(
  row: ReturnRow,
  setEditing: Dispatch<SetStateAction<number | null>>,
  setForm: Dispatch<SetStateAction<{ date: string; customerId: string; routeId: string; challanReference: string; remarks: string; allowReconciliation: boolean; reconciliationReason: string }>>,
  setLines: Dispatch<SetStateAction<Line[]>>,
  setRouteOverride: Dispatch<SetStateAction<boolean>>,
) {
  setEditing(row.id)
  setForm({ date: row.date, customerId: String(row.customerId), routeId: row.routeId ? String(row.routeId) : '', challanReference: row.challanReference, remarks: row.remarks, allowReconciliation: false, reconciliationReason: '' })
  setRouteOverride(true)
  setLines(row.lines.map((line) => ({ sizeId: String(line.sizeId), quantity: String(line.quantity), condition: line.condition as Line['condition'], serialNumbers: (line.serialNumbers ?? []).join('\n') })))
}
