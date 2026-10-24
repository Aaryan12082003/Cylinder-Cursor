import { useQuery } from '@tanstack/react-query'
import { formatCount } from '@shared/dates'
import { Boxes, Truck, Undo2, UserPlus, Users, Warehouse } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, EmptyState, Page, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { formatTimestamp } from '@shared/dates'

const tooltipStyle = { border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 12, color: '#0F172A' }

export function DashboardPage() {
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard })
  if (query.isLoading) {
    return (
      <Page title="Dashboard" subtitle="Stock, customers, and cylinders currently out.">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      </Page>
    )
  }
  if (query.isError || !query.data) {
    return (
      <Page title="Dashboard">
        <Card>
          <EmptyState icon={<Warehouse className="h-5 w-5" />} title="Dashboard unavailable" body={query.error instanceof Error ? query.error.message : 'Could not load records.'} action={<Button onClick={() => query.refetch()}>Retry</Button>} />
        </Card>
      </Page>
    )
  }
  const data = query.data
  const kpis = [
    { label: 'Total cylinders', value: data.totals.owned, hint: 'Owned by the company', icon: Boxes, tint: 'bg-indigo-50 text-primary' },
    { label: 'Available cylinders', value: data.totals.available, hint: 'Ready for dispatch', icon: Warehouse, tint: 'bg-emerald-50 text-emerald-600' },
    { label: 'With customers', value: data.totals.withCustomers, hint: `${data.totals.customersHolding} parties holding stock`, icon: Users, tint: 'bg-sky-50 text-sky-600' },
    { label: 'Active customers', value: data.totals.activeCustomers, hint: 'Not archived', icon: Users, tint: 'bg-violet-50 text-violet-600' },
    { label: 'Pending returns', value: data.totals.overdueCylinders, hint: `${data.totals.overdueCustomers} overdue parties`, icon: Undo2, tint: 'bg-amber-50 text-amber-600' },
    { label: 'Monthly dispatches', value: data.totals.dispatchQtyThisMonth, hint: `${data.totals.dispatchesThisMonth} documents`, icon: Truck, tint: 'bg-indigo-50 text-primary' },
  ]
  const quiet = data.totals.owned === 0 && data.recent.length === 0
  return (
    <Page
      title="Dashboard"
      subtitle="A live view of owned stock, cylinders with customers, and this month's movement."
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate('/inventory')}>Opening stock</Button>
          <Button onClick={() => navigate('/dispatch')}>Dispatch</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="p-4">
            <div className="flex items-start justify-between">
              <div className="text-[13px] text-muted">{kpi.label}</div>
              <div className={`grid h-8 w-8 place-items-center rounded-lg ${kpi.tint}`}>
                <kpi.icon className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 text-[30px] font-semibold leading-none tracking-tight">{formatCount(kpi.value)}</div>
            <div className="mt-2 text-xs text-muted">{kpi.hint}</div>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          ['Damaged', data.totals.damaged],
          ['Lost', data.totals.lost],
        ].map(([label, value]) => (
          <Card key={String(label)} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted">{label}</span>
            <span className="text-lg font-semibold">{formatCount(Number(value))}</span>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {data.sizes.filter((size) => ['3L', '10L', '23L'].includes(size.code) || size.owned > 0).map((size) => (
          <Card key={size.id} className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{size.name}</h2>
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{size.code}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Metric label="Owned" value={size.owned} />
              <Metric label="Available" value={size.available} />
              <Metric label="With customers" value={size.withCustomers} />
            </div>
            <div className="mt-4 text-xs text-muted">
              <span>Damaged {formatCount(size.damaged)}</span>
            </div>
          </Card>
        ))}
      </div>

      {quiet ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Boxes className="h-5 w-5" />}
            title="Set your opening stock to begin"
            body="Enter the cylinders you own, then add customers. Every total on this desk is calculated from those records."
            action={
              <div className="flex gap-2">
                <Button onClick={() => navigate('/inventory')}>Enter opening stock</Button>
                <Button variant="secondary" onClick={() => navigate('/customers')}>
                  <UserPlus className="h-4 w-4" /> Add customer
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2">
              <h2 className="text-base font-semibold">Dispatch and returns</h2>
              <p className="mb-4 text-xs text-muted">Cylinder quantities over the last 12 months</p>
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={data.monthly}>
                    <CartesianGrid stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="dispatched" name="Dispatched" fill="#4F46E5" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="returned" name="Returned" fill="#10B981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="text-base font-semibold">Owned by size</h2>
              <p className="mb-4 text-xs text-muted">Current company-owned cylinders</p>
              <div className="h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.distribution} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3}>
                      {data.distribution.map((entry, index) => (
                        <Cell key={entry.code} fill={['#4F46E5', '#10B981', '#F59E0B', '#64748B'][index % 4]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-4 text-base font-semibold">Top customers by cylinders held</h2>
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={data.topCustomers} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="total" name="Outstanding" fill="#4F46E5" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="mb-4 text-base font-semibold">Outstanding balance trend</h2>
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={data.outstandingTrend}>
                    <CartesianGrid stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="total" name="Outstanding" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-base font-semibold">Recent activity</h2>
          {data.recent.length === 0 ? <p className="text-sm text-muted">Activity appears here after the first stock entry, dispatch, or return.</p> : null}
          <div className="divide-y divide-border">
            {data.recent.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <div className="text-sm">{item.summary}</div>
                  <div className="text-xs text-muted">{item.actor}</div>
                </div>
                <div className="shrink-0 text-xs text-muted">{formatTimestamp(item.occurredAt)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-base font-semibold">Quick actions</h2>
          <div className="grid gap-2">
            <Button variant="secondary" onClick={() => navigate('/inventory')}>Set opening stock</Button>
            <Button variant="secondary" onClick={() => navigate('/customers')}>Add customer</Button>
            <Button variant="secondary" onClick={() => navigate('/dispatch')}>Dispatch cylinders</Button>
            <Button variant="secondary" onClick={() => navigate('/returns')}>Receive cylinders</Button>
            <Button variant="secondary" onClick={() => navigate('/backup')}>Back up database</Button>
          </div>
          <p className="mt-4 text-xs text-muted">Returns this month: {formatCount(data.totals.returnQtyThisMonth)} cylinders across {data.totals.returnsThisMonth} documents.</p>
        </Card>
      </div>
    </Page>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{formatCount(value)}</div>
    </div>
  )
}
