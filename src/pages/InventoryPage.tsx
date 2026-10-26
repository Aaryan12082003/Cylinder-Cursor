import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCount, formatDateOnly } from '@shared/dates'
import { Boxes } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Dialog, DialogContent, EmptyState, Field, Input, Page, Pagination, Select, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import { typeLabel } from '@/lib/utils'
import { todayIso } from '@shared/dates'

export function InventoryPage() {
  const qc = useQueryClient()
  const overview = useQuery({ queryKey: ['inventory'], queryFn: api.inventory })
  const [page, setPage] = useState(1)
  const [sizeId, setSizeId] = useState('')
  const movements = useQuery({
    queryKey: ['movements', page, sizeId],
    queryFn: () => api.movements({ page, pageSize: 10, sizeId: sizeId ? Number(sizeId) : undefined, sortDir: 'desc' }),
  })
  const [stockOpen, setStockOpen] = useState(false)
  const sizes = overview.data?.sizes ?? []

  return (
    <Page
      title="Cylinder inventory"
      subtitle="Set active stock by size and track every stock movement."
      actions={
        <Button onClick={() => setStockOpen(true)}>Manage stock</Button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-3">
        {sizes.map((size) => (
          <Card key={size.id} className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{size.name} cylinders</h2>
              {!size.isActive ? <span className="text-xs text-muted">Inactive</span> : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="Total stock" value={size.owned} />
              <Stat label="Available" value={size.available} />
              <Stat label="With customers" value={size.withCustomers} />
            </div>
            <div className="mt-3 flex justify-between text-xs text-muted">
              <span>{size.openingLocked ? 'Opening locked' : size.hasOpening ? 'Opening recorded' : 'No opening yet'}</span>
            </div>
          </Card>
        ))}
      </div>
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Movement history</h2>
          <Select className="h-9 max-w-48" value={sizeId} onChange={(event) => { setSizeId(event.target.value); setPage(1) }}>
            <option value="">All sizes</option>
            {sizes.map((size) => (
              <option key={size.id} value={size.id}>{size.name}</option>
            ))}
          </Select>
        </div>
        <table className="w-full text-left text-[13px]">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              {['Date', 'Type', 'Size', 'Party', 'Reference', 'Change', 'Remarks'].map((label) => (
                <th key={label} className="px-4 py-3 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {movements.data?.rows.length ? movements.data.rows.map((row) => (
              <tr key={row.id} className="border-t border-border hover:bg-background">
                <td className="px-4 py-3">{formatDateOnly(row.date)}</td>
                <td className="px-4 py-3 capitalize">{typeLabel(row.type)}</td>
                <td className="px-4 py-3">{row.sizeName}</td>
                <td className="px-4 py-3">{row.partyName || '—'}</td>
                <td className="px-4 py-3">{row.referenceNumber || '—'}</td>
                <td className="px-4 py-3 text-muted">{deltaSummary(row)}</td>
                <td className="px-4 py-3">{row.remarks || '—'}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={<Boxes className="h-5 w-5" />} title="No movements yet" body="Opening stock, dispatches, returns, and adjustments will be listed here." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageSize={10} total={movements.data?.total ?? 0} onPage={setPage} />
      </Card>
      <StockManagementDialog open={stockOpen} onOpenChange={setStockOpen} sizes={sizes} onSaved={() => qc.invalidateQueries()} />
    </Page>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold">{formatCount(value)}</div>
    </div>
  )
}

function deltaSummary(row: { filledDelta: number; emptyDelta: number; withCustomerDelta: number; damagedDelta: number; lostDelta: number; maintenanceDelta: number }) {
  const parts = [
    ['available stock', row.filledDelta + row.emptyDelta],
    ['with customers', row.withCustomerDelta],
  ].filter(([, value]) => Number(value) !== 0)
  return parts.map(([label, value]) => `${Number(value) > 0 ? '+' : ''}${value} ${label}`).join(', ') || '—'
}

type OpeningSize = {
  id: number
  name: string
  isActive: boolean
  openingLocked: boolean
  hasOpening: boolean
  filled: number
  empty: number
  damaged: number
  maintenance: number
  openingFilled?: number
  openingEmpty?: number
  openingDamaged?: number
  openingMaintenance?: number
}

function OpeningForm({ onClose, sizes, onSaved }: { onClose: () => void; sizes: OpeningSize[]; onSaved: () => void }) {
  const [rows, setRows] = useState<Record<number, { available: string }>>({})
  const [notes, setNotes] = useState('')
  const mutation = useMutation({
    mutationFn: api.setOpening,
    onSuccess: () => {
      toast.success('Opening stock saved')
      onSaved()
      onClose()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return (
        <div className="space-y-4">
          <p className="text-xs text-muted">Enter the active stock currently available for each cylinder size. Later increases and decreases use this number.</p>
          {sizes.map((size) => {
            // Opening values are kept separately from current on-hand values so an
            // audited correction does not accidentally replace the live balance.
            const value = rows[size.id] ?? { available: String(size.hasOpening ? (size.openingFilled ?? 0) + (size.openingEmpty ?? 0) : (size.filled ?? 0) + (size.empty ?? 0)) }
            const set = (key: keyof typeof value, next: string) => setRows((current) => ({ ...current, [size.id]: { ...value, [key]: next } }))
            return (
              <div key={size.id} className="rounded-xl border border-border p-3">
                <div className="mb-2 text-sm font-medium">
                  {size.name} {size.openingLocked ? <span className="text-xs font-normal text-muted">· audited correction</span> : null}
                </div>
                {size.openingLocked ? <p className="mb-2 text-xs text-muted">This opening balance is already posted. You can correct the audited opening values; later dispatches, returns, and adjustments are preserved.</p> : null}
                <Field label="Active stock"><Input value={value.available} onChange={(event) => set('available', event.target.value)} inputMode="numeric" /></Field>
              </div>
            )
          })}
          {sizes.some((size) => size.openingLocked) ? <p className="text-xs text-muted">A reason in Notes is required when correcting an audited opening balance.</p> : null}
          <Field label="Notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          <div className="flex justify-end">
            <Button
              onClick={() => mutation.mutate({
                rows: sizes.filter((size) => rows[size.id]).map((size) => {
                  const value = rows[size.id]
                  const available = Number(value?.available ?? (size.hasOpening ? (size.openingFilled ?? 0) + (size.openingEmpty ?? 0) : (size.filled ?? 0) + (size.empty ?? 0)))
                  return {
                    sizeId: size.id,
                    filled: Math.max(0, available),
                    empty: 0,
                    damaged: 0,
                    maintenance: 0,
                    notes,
                  }
                }),
              })}
              disabled={mutation.isPending || Object.keys(rows).length === 0}
            >
              Save opening stock
            </Button>
          </div>
        </div>
  )
}

function AdjustForm({ onClose, sizes, onSaved }: { onClose: () => void; sizes: { id: number; name: string; isActive: boolean }[]; onSaved: () => void }) {
  const [form, setForm] = useState({ date: todayIso(), mode: 'increase' as 'increase' | 'decrease', sizeId: '', quantity: '1', reason: '' })
  const mutation = useMutation({
    mutationFn: api.adjust,
    onSuccess: (result) => {
      toast.success(`${result.number} posted`)
      onSaved()
      onClose()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return (
        <div className="grid gap-3">
          <Field label="Date"><Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
          <Field label="Stock action">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={form.mode === 'increase' ? 'primary' : 'secondary'} onClick={() => setForm({ ...form, mode: 'increase' })}>Increase stock</Button>
              <Button type="button" variant={form.mode === 'decrease' ? 'primary' : 'secondary'} onClick={() => setForm({ ...form, mode: 'decrease' })}>Decrease stock</Button>
            </div>
          </Field>
          <Field label="Cylinder size">
            <Select value={form.sizeId} onChange={(event) => setForm({ ...form, sizeId: event.target.value })}>
              <option value="">Choose size</option>
              {sizes.filter((size) => size.isActive).map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
            </Select>
          </Field>
          <Field label="Quantity"><Input value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} inputMode="numeric" /></Field>
          <Field label="Reason (optional)"><Textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Optional note" /></Field>
          <div className="flex justify-end">
            <Button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({
                date: form.date,
                sizeId: Number(form.sizeId),
                fromState: form.mode === 'increase' ? 'external' : 'filled',
                toState: form.mode === 'increase' ? 'filled' : 'external',
                quantity: Number(form.quantity),
                reason: form.reason,
              })}
            >
              Post adjustment
            </Button>
          </div>
        </div>
  )
}

function StockManagementDialog({ open, onOpenChange, sizes, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; sizes: OpeningSize[]; onSaved: () => void }) {
  const [section, setSection] = useState<'opening' | 'adjustment'>('opening')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Manage stock"
        description="Set active stock by size or increase and decrease it as stock changes."
        className="max-w-2xl"
      >
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-background p-1">
          <Button type="button" variant={section === 'opening' ? 'primary' : 'secondary'} onClick={() => setSection('opening')}>
            Opening balance
          </Button>
          <Button type="button" variant={section === 'adjustment' ? 'primary' : 'secondary'} onClick={() => setSection('adjustment')}>
            Adjust stock
          </Button>
        </div>
        {section === 'opening' ? (
          <OpeningForm onClose={() => onOpenChange(false)} sizes={sizes} onSaved={onSaved} />
        ) : (
          <AdjustForm onClose={() => onOpenChange(false)} sizes={sizes} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  )
}
