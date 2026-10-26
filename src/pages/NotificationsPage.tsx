import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCount, formatDateOnly, formatTimestamp } from '@shared/dates'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Page } from '@/components/ui'
import { api } from '@/lib/api'
import type { AppNotification } from '@shared/types'

export function NotificationsPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications({ page: 1, pageSize: 50 }) })
  const [period, setPeriod] = useState<string | null>(null)
  const [selected, setSelected] = useState<AppNotification | null>(null)
  const report = useQuery({ queryKey: ['month-end', period], queryFn: () => api.monthEnd(period!), enabled: Boolean(period) })
  const read = useMutation({
    mutationFn: (id: number) => api.markRead(id),
    onSuccess: () => qc.invalidateQueries(),
  })
  const readAll = useMutation({ mutationFn: api.markAllRead, onSuccess: () => qc.invalidateQueries() })
  return (
    <Page
      title="Notifications"
      subtitle="Party-wise overdue alerts and month-end holding reports appear here. Native alerts are shown while CylinderFlow is open."
      actions={<Button variant="secondary" onClick={() => readAll.mutate()}>Mark all read</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-3">
          {list.data?.rows.map((item) => {
            const periodKey = typeof item.payload?.periodKey === 'string' ? item.payload.periodKey : null
            const overdue = item.kind === 'overdue-holding' || item.kind === 'overdue'
            return (
              <button key={item.id} className={`w-full rounded-xl border bg-surface p-4 text-left shadow-card ${overdue ? 'border-danger/40' : 'border-border'}`} onClick={() => { if (!item.readAt) read.mutate(item.id); if (periodKey) setPeriod(periodKey); setSelected(item) }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">{item.title}{overdue ? <Badge tone="danger">Overdue</Badge> : null}</div>
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
          {selected && (selected.kind === 'overdue-holding' || selected.kind === 'overdue') ? <OverdueDetail notification={selected} /> : report.data ? (
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
          ) : <EmptyState icon={<Bell className="h-5 w-5" />} title="Select a notification" body="Select an overdue alert or month-end report to view its party-wise details." />}
        </Card>
      </div>
    </Page>
  )
}

function OverdueDetail({ notification }: { notification: AppNotification }) {
  const payload = notification.payload ?? {}
  const partyName = typeof payload.partyName === 'string' ? payload.partyName : 'Customer'
  const total = Number(payload.total ?? payload.totalOutstanding ?? 0)
  const days = Number(payload.daysHeld ?? payload.daysSinceMovement ?? 0)
  const threshold = Number(payload.thresholdDays ?? 0)
  const balances = payload.balances && typeof payload.balances === 'object' ? Object.entries(payload.balances as Record<string, unknown>) : []
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge tone="danger">Overdue holding</Badge>
          <h2 className="mt-2 text-lg font-semibold">{partyName}</h2>
          <p className="text-sm text-muted">{notification.body}</p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Cylinders held</div><div className="text-lg font-semibold">{formatCount(total)}</div></div>
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Days since movement</div><div className="text-lg font-semibold">{formatCount(days)}</div></div>
        {threshold > 0 ? <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Alert after</div><div className="text-lg font-semibold">{formatCount(threshold)} days</div></div> : null}
      </div>
      {balances.length ? <div className="mt-5"><h3 className="text-sm font-semibold">Party-wise cylinder balance</h3><div className="mt-2 divide-y divide-border rounded-lg border border-border">{balances.map(([code, value]) => <div key={code} className="flex justify-between px-3 py-2 text-sm"><span>{code}</span><span className="font-semibold">{formatCount(Number(value))}</span></div>)}</div></div> : null}
    </div>
  )
}
