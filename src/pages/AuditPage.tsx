import { useQuery } from '@tanstack/react-query'
import { formatTimestamp } from '@shared/dates'
import { useState } from 'react'
import { Card, EmptyState, Input, Page, Pagination, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { ScrollText } from 'lucide-react'

export function AuditPage() {
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: ['audit', search, action, page], queryFn: () => api.audit({ page, pageSize: 15, search, action, sortDir: 'desc' }) })
  return (
    <Page title="Audit logs" subtitle="Posted documents are not edited in place. Corrections appear here as reversals or new adjustments.">
      <Card className="overflow-hidden">
        <div className="flex gap-2 border-b border-border px-4 py-3">
          <Input className="max-w-sm" value={search} placeholder="Search summary, actor, reference" onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          <Select className="w-52" value={action} onChange={(event) => { setAction(event.target.value); setPage(1) }}>
            <option value="">All actions</option>
            {['dispatch', 'return', 'dispatch_reversal', 'return_reversal', 'adjustment', 'reconciliation', 'opening_stock', 'customer_create', 'backup', 'restore'].map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
          </Select>
        </div>
        <table className="w-full text-left text-[13px]">
          <thead className="text-xs uppercase tracking-wide text-muted"><tr>{['When', 'Actor', 'Action', 'Summary'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>
            {query.data?.rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-4 py-3 whitespace-nowrap">{formatTimestamp(row.occurredAt)}</td>
                <td className="px-4 py-3">{row.actor}</td>
                <td className="px-4 py-3 capitalize">{row.action.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3">{row.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.data && query.data.total === 0 ? <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No audit entries" body="Creates, dispatches, returns, adjustments, and backups are recorded here." /> : null}
        <Pagination page={page} pageSize={15} total={query.data?.total ?? 0} onPage={setPage} />
      </Card>
    </Page>
  )
}
