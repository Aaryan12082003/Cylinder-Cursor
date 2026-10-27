import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, ConfirmDialog, Dialog, DialogContent, Field, Input, Page, Select } from '@/components/ui'
import { api } from '@/lib/api'
import type { AppSettings } from '@shared/types'

export function RoutesPage() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const routes = settings.data?.routes ?? []
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [routeSearch, setRouteSearch] = useState('')
  const [detailSearch, setDetailSearch] = useState('')
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<AppSettings['routes'][number] | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AppSettings['routes'][number] | null>(null)
  const activeId = selectedId ?? routes[0]?.id ?? null
  const detail = useQuery({ queryKey: ['route-detail', activeId, detailSearch], queryFn: () => api.routeDetail({ routeId: activeId, search: detailSearch }), enabled: activeId !== null, placeholderData: (previous) => previous?.route.id === activeId ? previous : undefined })
  const add = useMutation({ mutationFn: () => api.createRoute({ name: name.trim() }), onSuccess: () => { toast.success('Route added'); setName(''); qc.invalidateQueries({ queryKey: ['settings'] }) }, onError: (error: Error) => toast.error(error.message) })
  const remove = useMutation({ mutationFn: (id: number) => api.deleteRoute(id), onSuccess: () => { toast.success('Route deleted'); setDeleteTarget(null); setSelectedId(null); qc.invalidateQueries({ queryKey: ['settings'] }) }, onError: (error: Error) => toast.error(error.message) })
  const filtered = useMemo(() => routes.filter((route) => route.name.toLowerCase().includes(routeSearch.toLowerCase())), [routes, routeSearch])
  return <Page title="Routes" subtitle="Track route-wise cylinders, parties, and movement history.">
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <Card className="p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Route master</h2><span className="text-xs text-muted">{routes.length}</span></div>
        <div className="mt-3 space-y-2"><Input placeholder="Search routes" value={routeSearch} onChange={(event) => setRouteSearch(event.target.value)} />
          {filtered.map((route) => <button type="button" key={route.id} onClick={() => setSelectedId(route.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${activeId === route.id ? 'bg-primary-soft text-primary' : 'hover:bg-background'}`}><span>{route.name}</span><span className="text-xs text-muted">{route.isActive ? 'Active' : 'Inactive'}</span></button>)}
        </div>
        <div className="mt-4 flex gap-2"><Input placeholder="Add route" value={name} onChange={(event) => setName(event.target.value)} /><Button type="button" size="sm" disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>{add.isPending ? '…' : 'Add'}</Button></div>
      </Card>
      <div className="space-y-4">
        {detail.isError ? <Card className="p-5 text-sm text-danger">Unable to load this route: {(detail.error as Error).message}</Card> : detail.data ? <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="text-lg font-semibold">{detail.data.route.name}</h2><p className="text-sm text-muted">{detail.data.route.isActive ? 'Active route' : 'Inactive route'}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setEdit(routes.find((route) => route.id === activeId) ?? null)}>Edit</Button><Button variant="danger" onClick={() => setDeleteTarget(routes.find((route) => route.id === activeId) ?? null)}>Delete</Button></div></Card>
          <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h3 className="font-semibold">Cylinders currently held</h3><p className="text-sm text-muted">Customer-wise balances associated with this route.</p><div className="mt-3 max-w-md"><Input placeholder="Search customer, cylinder size, serial, or challan" value={detailSearch} onChange={(event) => setDetailSearch(event.target.value)} /></div></div><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr>{['Customer', 'Mobile', 'Cylinder size', 'Quantity', 'Serial numbers'].map((label) => <th key={label} className="px-5 py-3">{label}</th>)}</tr></thead><tbody>{detail.data.holdings.map((row, index) => <tr key={`${row.customerId}-${row.sizeName}-${index}`} className="border-t border-border"><td className="px-5 py-3 font-medium">{row.customerName}</td><td className="px-5 py-3">{row.mobile || '—'}</td><td className="px-5 py-3">{row.sizeName}</td><td className="px-5 py-3">{row.quantity}</td><td className="px-5 py-3">{row.serialNumbers.length ? row.serialNumbers.join(', ') : 'Quantity-only'}</td></tr>)}</tbody></table></div>{detail.data.holdings.length === 0 ? <p className="p-5 text-sm text-muted">No current cylinders are associated with this route.</p> : null}</Card>
          <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><h3 className="font-semibold">Route history</h3><p className="text-sm text-muted">Dispatches and returns recorded on this route.</p></div><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr>{['Type', 'Number', 'Date', 'Customer', 'Quantity', 'Challan', 'Status'].map((label) => <th key={label} className="px-5 py-3">{label}</th>)}</tr></thead><tbody>{detail.data.history.map((row) => <tr key={`${row.type}-${row.id}`} className="border-t border-border"><td className="px-5 py-3 capitalize">{row.type}</td><td className="px-5 py-3 font-medium">{row.number}</td><td className="px-5 py-3">{row.date}</td><td className="px-5 py-3">{row.customerName}</td><td className="px-5 py-3">{row.quantity}</td><td className="px-5 py-3">{row.challan || '—'}</td><td className="px-5 py-3">{row.reversed ? 'Reversed' : 'Posted'}</td></tr>)}</tbody></table></div>{detail.data.history.length === 0 ? <p className="p-5 text-sm text-muted">No history for this route yet.</p> : null}</Card>
        </> : <Card className="p-5 text-sm text-muted">Create or select a route to view its tracking details.</Card>}
      </div>
    </div>
    <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} title="Delete route?" body={deleteTarget ? `${deleteTarget.name} can only be deleted if it has no transaction history. Otherwise deactivate it instead.` : ''} confirmLabel="Delete route" danger onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)} disabled={remove.isPending} />
    <Dialog open={Boolean(edit)} onOpenChange={(open) => { if (!open) setEdit(null) }}><DialogContent title="Edit route" description="Rename or activate/deactivate this route.">{edit ? <div className="space-y-3"><Field label="Route name"><Input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></Field><Field label="Status"><Select value={edit.isActive ? 'active' : 'inactive'} onChange={(event) => setEdit({ ...edit, isActive: event.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></Select></Field><div className="flex justify-end"><Button onClick={() => api.updateRoute(edit).then(() => { toast.success('Route updated'); setEdit(null); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['route-detail'] }) }).catch((error: Error) => toast.error(error.message))}>Save changes</Button></div></div> : null}</DialogContent></Dialog>
  </Page>
}
