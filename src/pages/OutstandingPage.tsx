import { useQuery } from '@tanstack/react-query'
import { formatCount, formatDateOnly } from '@shared/dates'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Input, Page, Pagination } from '@/components/ui'
import { api } from '@/lib/api'
import { Scale } from 'lucide-react'

export function OutstandingPage() {
  const [search, setSearch] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['outstanding', search, overdueOnly, page],
    queryFn: () => api.outstanding({ page, pageSize: 10, search, overdueOnly }),
  })
  return (
    <Page
      title="Outstanding balances"
      subtitle="Cylinders currently held by customers, with days since the last movement."
      actions={<Button variant="secondary" onClick={() => api.exportExcel({ id: overdueOnly ? 'overdue' : 'outstanding' }).then((file) => toast.success(file.path ? `Saved ${file.path}` : 'Export cancelled')).catch((error: Error) => toast.error(error.message))}>Export</Button>}
    >
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          <Input className="max-w-sm" value={search} placeholder="Search customer or mobile" onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          <Button variant={overdueOnly ? 'primary' : 'secondary'} onClick={() => { setOverdueOnly((value) => !value); setPage(1) }}>{overdueOnly ? 'Showing overdue' : 'Show overdue only'}</Button>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>{['Customer', 'Mobile', '3 Ltr', '10 Ltr', '23 Ltr', 'Total', 'Last dispatch', 'Last return', 'Days', ''].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr>
            </thead>
            <tbody>
              {query.data?.rows.map((row) => (
                <tr key={row.customerId} className="border-t border-border hover:bg-background">
                  <td className="px-4 py-3 font-medium">{row.partyName}</td>
                  <td className="px-4 py-3">{row.mobile || '—'}</td>
                  <td className="px-4 py-3">{qty(row.balances, '3L')}</td>
                  <td className="px-4 py-3">{qty(row.balances, '10L')}</td>
                  <td className="px-4 py-3">{qty(row.balances, '23L')}</td>
                  <td className="px-4 py-3 font-semibold">{formatCount(row.total)}</td>
                  <td className="px-4 py-3">{formatDateOnly(row.lastDispatchDate)}</td>
                  <td className="px-4 py-3">{formatDateOnly(row.lastReturnDate)}</td>
                  <td className="px-4 py-3">{row.daysSinceMovement ?? '—'}</td>
                  <td className="px-4 py-3">{row.overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="success">Within period</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.data && query.data.total === 0 ? <EmptyState icon={<Scale className="h-5 w-5" />} title="No outstanding cylinders" body="Customers appear here when a dispatch, opening balance, or reconciliation leaves cylinders with them." /> : null}
        </div>
        <Pagination page={page} pageSize={10} total={query.data?.total ?? 0} onPage={setPage} />
      </Card>
    </Page>
  )
}

function qty(balances: { code: string; outstanding: number }[], code: string) {
  return formatCount(balances.find((item) => item.code === code)?.outstanding ?? 0)
}
