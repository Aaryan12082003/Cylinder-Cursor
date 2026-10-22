import { useQuery } from '@tanstack/react-query'
import { formatDateOnly } from '@shared/dates'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, EmptyState, Field, Input, Page, Pagination, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { BookOpen } from 'lucide-react'

export function LedgerPage() {
  const [params] = useSearchParams()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const customers = useQuery({ queryKey: ['customers', 'ledger'], queryFn: () => api.customers({ page: 1, pageSize: 100, status: 'all', sortBy: 'partyName', sortDir: 'asc' }) })
  const [filters, setFilters] = useState({ customerId: params.get('customer') ?? '', sizeId: '', type: '', from: '', to: '', search: '' })
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['ledger-page', filters, page],
    queryFn: () => api.ledger({
      page,
      pageSize: 12,
      search: filters.search,
      customerId: filters.customerId ? Number(filters.customerId) : undefined,
      sizeId: filters.sizeId ? Number(filters.sizeId) : undefined,
      type: filters.type,
      from: filters.from,
      to: filters.to,
      sortDir: 'desc',
    }),
  })
  const exportFilters = {
    id: 'customer-ledger',
    customerId: filters.customerId ? Number(filters.customerId) : undefined,
    sizeId: filters.sizeId ? Number(filters.sizeId) : undefined,
    from: filters.from,
    to: filters.to,
  }
  return (
    <Page
      title="Cylinder ledger"
      subtitle="Closing outstanding = opening + dispatched − returned + authorized adjustments."
      actions={
        <>
          <Button variant="secondary" onClick={() => exportFile('excel', exportFilters)}>Excel</Button>
          <Button variant="secondary" onClick={() => exportFile('pdf', exportFilters)}>PDF</Button>
        </>
      }
    >
      <Card className="mb-4 grid gap-3 p-4 md:grid-cols-6">
        <Field label="Customer"><Select value={filters.customerId} onChange={(event) => { setFilters({ ...filters, customerId: event.target.value }); setPage(1) }}><option value="">All</option>{customers.data?.rows.map((row) => <option key={row.id} value={row.id}>{row.partyName}</option>)}</Select></Field>
        <Field label="Size"><Select value={filters.sizeId} onChange={(event) => { setFilters({ ...filters, sizeId: event.target.value }); setPage(1) }}><option value="">All</option>{settings.data?.sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</Select></Field>
        <Field label="Type"><Select value={filters.type} onChange={(event) => { setFilters({ ...filters, type: event.target.value }); setPage(1) }}><option value="">All</option><option value="dispatch">Dispatch</option><option value="return">Return</option><option value="opening">Opening</option><option value="reconciliation">Reconciliation</option><option value="dispatch_reversal">Dispatch reversal</option><option value="return_reversal">Return reversal</option></Select></Field>
        <Field label="From"><Input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></Field>
        <Field label="To"><Input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></Field>
        <Field label="Search"><Input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Reference" /></Field>
      </Card>
      {query.data?.summary ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-5">
          <Summary label="Opening" value={query.data.summary.opening} />
          <Summary label="Dispatched" value={query.data.summary.dispatched} />
          <Summary label="Returned" value={query.data.summary.returned} />
          <Summary label="Adjustment" value={query.data.summary.adjustment} />
          <Summary label="Closing" value={query.data.summary.closing} />
        </div>
      ) : null}
      <Card className="overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full min-w-[1100px] text-left text-[13px]">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>{['Date', 'Transaction', 'Party', 'Size', 'Opening', 'Dispatched', 'Returned', 'Adjustment', 'Closing', 'Reference', 'Remarks'].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr>
            </thead>
            <tbody>
              {query.data?.rows.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-background">
                  <td className="px-3 py-3">{formatDateOnly(row.date, settings.data?.dateFormat)}</td>
                  <td className="px-3 py-3 font-medium">{row.transactionId}</td>
                  <td className="px-3 py-3">{row.partyName}</td>
                  <td className="px-3 py-3">{row.sizeName}</td>
                  <td className="px-3 py-3">{row.openingBalance}</td>
                  <td className="px-3 py-3">{row.dispatched}</td>
                  <td className="px-3 py-3">{row.returned}</td>
                  <td className="px-3 py-3">{row.adjustment}</td>
                  <td className="px-3 py-3 font-semibold">{row.closingBalance}</td>
                  <td className="px-3 py-3">{row.referenceNumber || '—'}</td>
                  <td className="px-3 py-3">{row.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.data && query.data.total === 0 ? <EmptyState icon={<BookOpen className="h-5 w-5" />} title="No ledger entries" body="Dispatches, returns, openings, and reconciliations are posted here and are never silently deleted." /> : null}
        </div>
        <Pagination page={page} pageSize={12} total={query.data?.total ?? 0} onPage={setPage} />
      </Card>
    </Page>
  )
}

function Summary({ label, value }: { label: string; value: number | null }) {
  return <Card className="px-4 py-3"><div className="text-xs text-muted">{label}</div><div className="text-lg font-semibold">{value === null ? '—' : value}</div></Card>
}

function exportFile(kind: 'excel' | 'pdf', filters: { id: string; customerId?: number; sizeId?: string | number; from?: string; to?: string }) {
  if (!filters.customerId) {
    toast.error('Choose a customer before exporting a ledger.')
    return
  }
  const run = kind === 'excel' ? api.exportExcel(filters) : api.exportPdf(filters)
  run.then((file) => toast.success(file.path ? `Saved ${file.path}` : 'Export cancelled')).catch((error: Error) => toast.error(error.message))
}
