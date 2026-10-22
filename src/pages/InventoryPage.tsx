import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCount, formatDateOnly } from '@shared/dates'
import { Boxes } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, Dialog, DialogContent, EmptyState, Field, Input, Page, Pagination, Select, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import { conditionLabel, typeLabel } from '@/lib/utils'
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
  const [openingOpen, setOpeningOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const sizes = overview.data?.sizes ?? []

  return (
    <Page
      title="Cylinder inventory"
      subtitle="Opening quantities, on-hand conditions, and every stock movement."
      actions={
        <>
          <Button variant="secondary" onClick={() => setAdjustOpen(true)}>Adjust stock</Button>
          <Button onClick={() => setOpeningOpen(true)}>Set opening balance</Button>
        </>
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
              <Stat label="Filled" value={size.filled} />
              <Stat label="Empty" value={size.empty} />
              <Stat label="Damaged" value={size.damaged} />
            </div>
            <div className="mt-3 flex justify-between text-xs text-muted">
              <span>Lost {formatCount(size.lost)}</span>
              <span>Maintenance {formatCount(size.maintenance)}</span>
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
      <OpeningDialog open={openingOpen} onOpenChange={setOpeningOpen} sizes={sizes} onSaved={() => qc.invalidateQueries()} />
      <AdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} sizes={sizes} onSaved={() => qc.invalidateQueries()} />
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
    ['filled', row.filledDelta],
    ['empty', row.emptyDelta],
    ['with customers', row.withCustomerDelta],
    ['damaged', row.damagedDelta],
    ['lost', row.lostDelta],
    ['maintenance', row.maintenanceDelta],
  ].filter(([, value]) => Number(value) !== 0)
  return parts.map(([label, value]) => `${Number(value) > 0 ? '+' : ''}${value} ${label}`).join(', ') || '—'
}

function OpeningDialog({ open, onOpenChange, sizes, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; sizes: { id: number; name: string; openingLocked: boolean; filled: number; empty: number; damaged: number; maintenance: number }[]; onSaved: () => void }) {
  const [rows, setRows] = useState<Record<number, { filled: string; empty: string; damaged: string; maintenance: string }>>({})
  const [notes, setNotes] = useState('')
  const mutation = useMutation({
    mutationFn: api.setOpening,
    onSuccess: () => {
      toast.success('Opening stock saved')
      onSaved()
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Opening stock" description="Enter the cylinders currently on hand. Customer opening balances are recorded on each customer.">
        <div className="space-y-4">
          {sizes.filter((size) => !('isActive' in size) || true).map((size) => {
            const value = rows[size.id] ?? { filled: String(size.filled || ''), empty: String(size.empty || ''), damaged: String(size.damaged || ''), maintenance: String(size.maintenance || '') }
            const set = (key: keyof typeof value, next: string) => setRows((current) => ({ ...current, [size.id]: { ...value, [key]: next } }))
            return (
              <div key={size.id} className="rounded-xl border border-border p-3">
                <div className="mb-2 text-sm font-medium">{size.name} {size.openingLocked ? <span className="text-xs font-normal text-muted">· locked</span> : null}</div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Field label="Filled"><Input disabled={size.openingLocked} value={value.filled} onChange={(event) => set('filled', event.target.value)} inputMode="numeric" /></Field>
                  <Field label="Empty"><Input disabled={size.openingLocked} value={value.empty} onChange={(event) => set('empty', event.target.value)} inputMode="numeric" /></Field>
                  <Field label="Damaged"><Input disabled={size.openingLocked} value={value.damaged} onChange={(event) => set('damaged', event.target.value)} inputMode="numeric" /></Field>
                  <Field label="Maintenance"><Input disabled={size.openingLocked} value={value.maintenance} onChange={(event) => set('maintenance', event.target.value)} inputMode="numeric" /></Field>
                </div>
              </div>
            )
          })}
          <Field label="Notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          <div className="flex justify-end">
            <Button
              onClick={() => mutation.mutate({
                rows: sizes.filter((size) => !size.openingLocked).map((size) => {
                  const value = rows[size.id]
                  return {
                    sizeId: size.id,
                    filled: Number(value?.filled || size.filled || 0),
                    empty: Number(value?.empty || size.empty || 0),
                    damaged: Number(value?.damaged || size.damaged || 0),
                    maintenance: Number(value?.maintenance || size.maintenance || 0),
                    notes,
                  }
                }),
              })}
              disabled={mutation.isPending}
            >
              Save opening stock
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AdjustDialog({ open, onOpenChange, sizes, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; sizes: { id: number; name: string; isActive: boolean }[]; onSaved: () => void }) {
  const [form, setForm] = useState({ date: todayIso(), sizeId: '', fromState: 'filled', toState: 'damaged', quantity: '1', reason: '' })
  const mutation = useMutation({
    mutationFn: api.adjust,
    onSuccess: (result) => {
      toast.success(`${result.number} posted`)
      onSaved()
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const states = [
    ['filled', 'Filled available'],
    ['empty', 'Empty available'],
    ['damaged', 'Damaged'],
    ['lost', 'Lost'],
    ['maintenance', 'Under maintenance'],
    ['external', 'Outside the books'],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Inventory adjustment" description="A reason is required. This posts an audited movement and cannot make stock negative." className="max-w-lg">
        <div className="grid gap-3">
          <Field label="Date"><Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
          <Field label="Cylinder size">
            <Select value={form.sizeId} onChange={(event) => setForm({ ...form, sizeId: event.target.value })}>
              <option value="">Choose size</option>
              {sizes.filter((size) => size.isActive).map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Select value={form.fromState} onChange={(event) => setForm({ ...form, fromState: event.target.value })}>
                {states.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="To">
              <Select value={form.toState} onChange={(event) => setForm({ ...form, toState: event.target.value })}>
                {states.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Quantity"><Input value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} inputMode="numeric" /></Field>
          <Field label="Reason"><Textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field>
          <div className="flex justify-end">
            <Button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ ...form, sizeId: Number(form.sizeId), quantity: Number(form.quantity) })}
            >
              Post adjustment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

void conditionLabel
