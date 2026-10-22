import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCount, formatDateOnly, formatTimestamp } from '@shared/dates'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Page } from '@/components/ui'
import { api } from '@/lib/api'

export function NotificationsPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications({ page: 1, pageSize: 50 }) })
  const [period, setPeriod] = useState<string | null>(null)
  const report = useQuery({ queryKey: ['month-end', period], queryFn: () => api.monthEnd(period!), enabled: Boolean(period) })
  const read = useMutation({
    mutationFn: (id: number) => api.markRead(id),
    onSuccess: () => qc.invalidateQueries(),
  })
  const readAll = useMutation({ mutationFn: api.markAllRead, onSuccess: () => qc.invalidateQueries() })
  return (
    <Page
      title="Notifications"
      subtitle="Month-end holding reports are created the next time CylinderFlow is open after a month closes, and while it is running at the rollover. Native alerts are shown only when the app is open."
      actions={<Button variant="secondary" onClick={() => readAll.mutate()}>Mark all read</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-3">
          {list.data?.rows.map((item) => {
            const periodKey = typeof item.payload?.periodKey === 'string' ? item.payload.periodKey : null
            return (
              <button key={item.id} className="w-full rounded-xl border border-border bg-surface p-4 text-left shadow-card" onClick={() => { if (!item.readAt) read.mutate(item.id); if (periodKey) setPeriod(periodKey) }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-semibold">{item.title}</div>
                  {item.readAt ? null : <span className="mt-1 h-2 w-2 rounded-full bg-primary" />}
                </div>
                <p className="mt-1 text-sm text-muted">{item.body}</p>
                <div className="mt-2 text-xs text-muted">{formatTimestamp(item.createdAt)}</div>
              </button>
            )
          })}
          {list.data && list.data.total === 0 ? <Card><EmptyState icon={<Bell className="h-5 w-5" />} title="No notifications" body="A month-end report is created once, after the calendar month has ended." /></Card> : null}
        </div>
        <Card className="p-5">
          {report.data ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{report.data.periodLabel}</h2>
                  <p className="text-sm text-muted">As of {formatDateOnly(report.data.asOfDate)} · {formatCount(report.data.totalWithCustomers)} cylinders with {report.data.customerCount} customers</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => api.exportExcel({ id: 'month-end', periodKey: report.data?.periodKey }).then((file) => toast.success(file.path ?? 'Cancelled'))}>Excel</Button>
                  <Button size="sm" variant="secondary" onClick={() => api.exportPdf({ id: 'month-end', periodKey: report.data?.periodKey }).then((file) => toast.success(file.path ?? 'Cancelled'))}>PDF</Button>
                </div>
              </div>
              <div className="mt-4 overflow-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-xs uppercase tracking-wide text-muted"><tr>{['Customer', 'Mobile', '3 Ltr', '10 Ltr', '23 Ltr', 'Total', 'Days', ''].map((label) => <th key={label} className="py-2 pr-3 font-medium">{label}</th>)}</tr></thead>
                  <tbody>
                    {report.data.items.map((item) => (
                      <tr key={item.customerId} className="border-t border-border">
                        <td className="py-2 pr-3 font-medium">{item.customerName}</td>
                        <td className="py-2 pr-3">{item.mobile || '—'}</td>
                        <td className="py-2 pr-3">{item.balances['3L'] ?? 0}</td>
                        <td className="py-2 pr-3">{item.balances['10L'] ?? 0}</td>
                        <td className="py-2 pr-3">{item.balances['23L'] ?? 0}</td>
                        <td className="py-2 pr-3 font-semibold">{item.totalOutstanding}</td>
                        <td className="py-2 pr-3">{item.daysSinceMovement ?? '—'}</td>
                        <td className="py-2">{item.overdue ? <Badge tone="danger">Overdue</Badge> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.data.items.length === 0 ? <p className="py-6 text-sm text-muted">No customers held cylinders at this closing.</p> : null}
              </div>
            </>
          ) : <EmptyState icon={<Bell className="h-5 w-5" />} title="Select a notification" body="Month-end alerts open the stored customer-wise cylinder balances for that closing." />}
        </Card>
      </div>
    </Page>
  )
}
