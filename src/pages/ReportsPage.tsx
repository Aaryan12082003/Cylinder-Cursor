import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, Field, Input, Page, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { BarChart3 } from 'lucide-react'

export function ReportsPage() {
  const catalog = useQuery({ queryKey: ['report-catalog'], queryFn: api.reportCatalog })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const customers = useQuery({ queryKey: ['customers', 'reports'], queryFn: () => api.customers({ page: 1, pageSize: 100, status: 'all', sortBy: 'partyName', sortDir: 'asc' }) })
  const periods = useQuery({ queryKey: ['month-ends'], queryFn: api.monthEnds })
  const [selected, setSelected] = useState('inventory')
  const [filters, setFilters] = useState({ from: '', to: '', customerId: '', sizeId: '', periodKey: '', routeId: '' })
  const payload = {
    id: selected,
    from: filters.from,
    to: filters.to,
    customerId: filters.customerId ? Number(filters.customerId) : undefined,
    sizeId: filters.sizeId ? Number(filters.sizeId) : undefined,
    periodKey: filters.periodKey,
    routeId: filters.routeId ? Number(filters.routeId) : undefined,
  }
  const report = useQuery({ queryKey: ['report', payload], queryFn: () => api.runReport(payload), retry: false })
  return (
    <Page title="Reports & analytics" subtitle="Printable views of stock, movement, overdue holdings, and month-end closings.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {catalog.data?.map((item) => (
          <button key={item.id} onClick={() => setSelected(item.id)} className={`rounded-xl border p-4 text-left ${selected === item.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface'}`}>
            <div className="text-sm font-semibold">{item.title}</div>
            <div className="mt-1 text-xs text-muted">{item.description}</div>
          </button>
        ))}
      </div>
      <Card className="mt-4 p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="From"><Input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></Field>
          <Field label="To"><Input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></Field>
          <Field label="Customer"><Select value={filters.customerId} onChange={(event) => setFilters({ ...filters, customerId: event.target.value })}><option value="">All</option>{customers.data?.rows.map((row) => <option key={row.id} value={row.id}>{row.partyName}</option>)}</Select></Field>
          <Field label="Size"><Select value={filters.sizeId} onChange={(event) => setFilters({ ...filters, sizeId: event.target.value })}><option value="">All</option>{settings.data?.sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</Select></Field>
          <Field label="Route"><Select value={filters.routeId} onChange={(event) => setFilters({ ...filters, routeId: event.target.value })}><option value="">All routes</option>{settings.data?.routes.map((route) => <option key={route.id} value={route.id}>{route.name}{route.isActive ? '' : ' (inactive)'}</option>)}</Select></Field>
          <Field label="Month-end"><Select value={filters.periodKey} onChange={(event) => setFilters({ ...filters, periodKey: event.target.value })}><option value="">Latest</option>{periods.data?.map((period) => <option key={period.periodKey} value={period.periodKey}>{period.periodLabel}</option>)}</Select></Field>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => api.exportExcel(payload).then(saved).catch(failed)}>Excel</Button>
          <Button variant="secondary" onClick={() => api.exportPdf(payload).then(saved).catch(failed)}>PDF</Button>
        </div>
      </Card>
      <Card className="mt-4 overflow-hidden">
        {report.isError ? <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="Report needs a choice" body={report.error instanceof Error ? report.error.message : 'Could not run the report.'} /> : null}
        {report.data ? (
          <>
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold">{report.data.title}</h2>
              <p className="text-xs text-muted">{report.data.subtitle}</p>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>{report.data.columns.map((column) => <th key={column.key} className={`px-3 py-3 font-medium ${column.align === 'right' ? 'text-right' : ''}`}>{column.label}</th>)}</tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {report.data?.columns.map((column) => <td key={column.key} className={`px-3 py-3 ${column.align === 'right' ? 'text-right' : ''}`}>{String(row[column.key] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.data.rows.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No rows for this filter.</p> : null}
            </div>
            <div className="flex flex-wrap gap-4 border-t border-border px-4 py-3 text-sm">
              {report.data.summary.map((item) => <span key={item.label}><span className="text-muted">{item.label}: </span><span className="font-semibold">{item.value}</span></span>)}
            </div>
          </>
        ) : null}
      </Card>
    </Page>
  )
}

function saved(file: { path: string | null }) {
  toast.success(file.path ? `Saved ${file.path}` : 'Export cancelled')
}
function failed(error: Error) {
  toast.error(error.message)
}
