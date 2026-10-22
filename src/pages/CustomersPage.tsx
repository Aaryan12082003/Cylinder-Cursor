import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { zodResolver } from '@hookform/resolvers/zod'
import { formatCount, formatDateOnly } from '@shared/dates'
import { customerCreateSchema, type CustomerCreateInput } from '@shared/schemas'
import type { CustomerRow } from '@shared/types'
import { MoreHorizontal, Plus, Search, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, Field, Input, Menu, MenuItem, Page, Pagination, Select, Sheet, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import { initials } from '@/lib/utils'

const emptyCustomer: CustomerCreateInput = {
  partyName: '',
  contactPerson: '',
  mobile: '',
  alternateMobile: '',
  email: '',
  gstNumber: '',
  billingAddress: '',
  deliveryAddress: '',
  city: '',
  state: '',
  pinCode: '',
  status: 'active',
  notes: '',
  openingBalances: [],
}

export function CustomersPage() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'open' | 'active' | 'inactive' | 'archived' | 'all'>('open')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<CustomerRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<number | null>(params.get('open') ? Number(params.get('open')) : null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(timer)
  }, [search])
  const query = useQuery({
    queryKey: ['customers', debounced, status, page],
    queryFn: () => api.customers({ page, pageSize: 10, search: debounced, status, sortBy: 'partyName', sortDir: 'asc' }),
  })
  const sizes = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) => api.archiveCustomer(id, archived),
    onSuccess: () => {
      toast.success('Customer updated')
      qc.invalidateQueries()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const columns = useMemo<ColumnDef<CustomerRow>[]>(
    () => [
      {
        id: 'party',
        header: 'Customer / Party',
        cell: ({ row }) => (
          <button className="flex items-center gap-3 text-left" onClick={() => setOpenId(row.original.id)}>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials(row.original.partyName)}</span>
            <span>
              <span className="block font-medium">{row.original.partyName}</span>
              <span className="text-xs text-muted">{row.original.code}{row.original.city ? ` · ${row.original.city}` : ''}</span>
            </span>
          </button>
        ),
      },
      { accessorKey: 'contactPerson', header: 'Contact', cell: ({ row }) => row.original.contactPerson || '—' },
      { accessorKey: 'mobile', header: 'Mobile', cell: ({ row }) => row.original.mobile || '—' },
      { id: '3L', header: '3 Ltr', cell: ({ row }) => balance(row.original, '3L') },
      { id: '10L', header: '10 Ltr', cell: ({ row }) => balance(row.original, '10L') },
      { id: '23L', header: '23 Ltr', cell: ({ row }) => balance(row.original, '23L') },
      { id: 'total', header: 'Total', cell: ({ row }) => <span className="font-semibold">{formatCount(row.original.totalOutstanding)}</span> },
      { id: 'status', header: 'Status', cell: ({ row }) => <Status row={row.original} /> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="text-right">
            <Menu trigger={<button className="rounded-lg p-1 text-muted hover:bg-background" aria-label="Customer actions"><MoreHorizontal className="h-4 w-4" /></button>}>
              <MenuItem onSelect={() => setOpenId(row.original.id)}>View profile</MenuItem>
              <MenuItem onSelect={() => setEditing(row.original)}>Edit</MenuItem>
              <MenuItem onSelect={() => navigate(`/dispatch?customer=${row.original.id}`)}>Dispatch</MenuItem>
              <MenuItem onSelect={() => navigate(`/returns?customer=${row.original.id}`)}>Receive</MenuItem>
              <MenuItem danger={!row.original.archivedAt} onSelect={() => archive.mutate({ id: row.original.id, archived: !row.original.archivedAt })}>{row.original.archivedAt ? 'Restore' : 'Archive'}</MenuItem>
            </Menu>
          </div>
        ),
      },
    ],
    [archive, navigate],
  )
  const table = useReactTable({ data: query.data?.rows ?? [], columns, getCoreRowModel: getCoreRowModel() })

  return (
    <Page
      title="Customers"
      subtitle="Parties that receive cylinders and the balances they currently hold."
      actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add customer</Button>}
    >
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <Input className="pl-9" value={search} placeholder="Search name, mobile, GSTIN, city" onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          </div>
          <Select className="h-10 w-40" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1) }}>
            <option value="open">Open</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
          <Button variant="secondary" onClick={() => api.exportExcel({ id: 'customers' }).then((file) => toast.success(file.path ? `Exported ${file.path}` : 'Export cancelled')).catch((error: Error) => toast.error(error.message))}>Export</Button>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-[13px]">
            <thead className="text-xs uppercase tracking-wide text-muted">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id} className="px-4 py-3 font-medium">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-background">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {query.data && query.data.total === 0 ? <EmptyState icon={<Users className="h-5 w-5" />} title="No customers yet" body="Add a party to start dispatching cylinders and tracking what they hold." action={<Button onClick={() => setCreating(true)}>Add customer</Button>} /> : null}
        </div>
        <Pagination page={page} pageSize={10} total={query.data?.total ?? 0} onPage={setPage} />
      </Card>
      <CustomerForm
        open={creating || Boolean(editing)}
        customer={editing}
        sizes={sizes.data?.sizes ?? []}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
      <CustomerProfile id={openId} onClose={() => { setOpenId(null); setParams({}) }} onEdit={(row) => { setOpenId(null); setEditing(row) }} />
    </Page>
  )
}

function balance(row: CustomerRow, code: string) {
  return formatCount(row.balances.find((item) => item.code === code)?.outstanding ?? 0)
}

function Status({ row }: { row: CustomerRow }) {
  if (row.archivedAt) return <Badge tone="warning">Archived</Badge>
  if (row.status === 'inactive') return <Badge>Inactive</Badge>
  return <Badge tone="success">Active</Badge>
}

function CustomerForm({ open, customer, sizes, onOpenChange }: { open: boolean; customer: CustomerRow | null; sizes: { id: number; code: string; name: string; isActive: boolean }[]; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const form = useForm<CustomerCreateInput>({
    resolver: zodResolver(customerCreateSchema),
    defaultValues: emptyCustomer,
  })
  useEffect(() => {
    if (!open) return
    form.reset(customer ? { ...emptyCustomer, ...customer, openingBalances: [] } : emptyCustomer)
  }, [open, customer, form])
  const [openings, setOpenings] = useState<Record<number, string>>({})
  const save = useMutation({
    mutationFn: (values: CustomerCreateInput) => customer ? api.updateCustomer({ ...values, id: customer.id }) : api.createCustomer({
      ...values,
      openingBalances: Object.entries(openings).filter(([, quantity]) => Number(quantity) > 0).map(([sizeId, quantity]) => ({ sizeId: Number(sizeId), quantity: Number(quantity) })),
    }),
    onSuccess: () => {
      toast.success(customer ? 'Customer updated' : 'Customer added')
      qc.invalidateQueries()
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={customer ? 'Edit customer' : 'Add customer'} description="Indian mobile, GSTIN, and PIN are validated when provided.">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label="Party / company name" error={form.formState.errors.partyName?.message}><Input {...form.register('partyName')} /></Field>
          <Field label="Contact person"><Input {...form.register('contactPerson')} /></Field>
          <Field label="Mobile" error={form.formState.errors.mobile?.message}><Input {...form.register('mobile')} placeholder="10-digit mobile" /></Field>
          <Field label="Alternate mobile" error={form.formState.errors.alternateMobile?.message}><Input {...form.register('alternateMobile')} /></Field>
          <Field label="Email" error={form.formState.errors.email?.message}><Input {...form.register('email')} /></Field>
          <Field label="GSTIN" error={form.formState.errors.gstNumber?.message}><Input {...form.register('gstNumber')} /></Field>
          <Field label="Billing address"><Textarea {...form.register('billingAddress')} /></Field>
          <Field label="Delivery address"><Textarea {...form.register('deliveryAddress')} /></Field>
          <Field label="City"><Input {...form.register('city')} /></Field>
          <Field label="State"><Input {...form.register('state')} /></Field>
          <Field label="PIN code" error={form.formState.errors.pinCode?.message}><Input {...form.register('pinCode')} /></Field>
          <Field label="Status">
            <Select {...form.register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes"><Textarea {...form.register('notes')} /></Field>
          </div>
          {customer ? null : (
            <div className="md:col-span-2 rounded-xl border border-border p-3">
              <div className="mb-2 text-sm font-medium">Opening cylinder balance</div>
              <p className="mb-3 text-xs text-muted">Cylinders this party already holds. This increases outstanding and company stock with customers. It does not reduce available stock.</p>
              <div className="grid gap-2 md:grid-cols-3">
                {sizes.filter((size) => size.isActive).map((size) => (
                  <Field key={size.id} label={size.name}>
                    <Input value={openings[size.id] ?? ''} onChange={(event) => setOpenings({ ...openings, [size.id]: event.target.value })} inputMode="numeric" placeholder="0" />
                  </Field>
                ))}
              </div>
            </div>
          )}
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{customer ? 'Save changes' : 'Add customer'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CustomerProfile({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (row: CustomerRow) => void }) {
  const navigate = useNavigate()
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customer(id!), enabled: Boolean(id) })
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api.ledger({ page: 1, pageSize: 8, customerId: id, sortDir: 'desc' }), enabled: Boolean(id) })
  const row = customer.data
  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => { if (!open) onClose() }} title={row?.partyName ?? 'Customer'}>
      {row ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft font-semibold text-primary">{initials(row.partyName)}</div>
            <div>
              <div className="text-sm text-muted">{row.code}</div>
              <Status row={row} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Contact" value={row.contactPerson} />
            <Info label="Mobile" value={row.mobile} />
            <Info label="Email" value={row.email} />
            <Info label="GSTIN" value={row.gstNumber} />
            <Info label="City" value={[row.city, row.state, row.pinCode].filter(Boolean).join(', ')} />
            <Info label="Created" value={formatDateOnly(row.createdAt.slice(0, 10))} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Cylinder balance</h3>
            <div className="grid grid-cols-3 gap-2">
              {row.balances.map((item) => (
                <div key={item.sizeId} className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted">{item.name}</div>
                  <div className="text-xl font-semibold">{formatCount(item.outstanding)}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-sm font-medium">Total {formatCount(row.totalOutstanding)} cylinders</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate(`/dispatch?customer=${row.id}`)}>Dispatch</Button>
            <Button size="sm" variant="secondary" onClick={() => navigate(`/returns?customer=${row.id}`)}>Receive</Button>
            <Button size="sm" variant="secondary" onClick={() => onEdit(row)}>Edit</Button>
            <Button size="sm" variant="secondary" onClick={() => navigate(`/ledger?customer=${row.id}`)}>Ledger</Button>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Recent transactions</h3>
            <div className="divide-y divide-border text-sm">
              {ledger.data?.rows.map((entry) => (
                <div key={entry.id} className="flex justify-between py-2">
                  <div>
                    <div className="font-medium">{entry.transactionId}</div>
                    <div className="text-xs text-muted">{entry.sizeName} · {entry.transactionType.replaceAll('_', ' ')}</div>
                  </div>
                  <div className="text-right">
                    <div>{formatDateOnly(entry.date)}</div>
                    <div className="text-xs text-muted">Close {entry.closingBalance}</div>
                  </div>
                </div>
              ))}
              {ledger.data && ledger.data.rows.length === 0 ? <p className="text-sm text-muted">No transactions yet.</p> : null}
            </div>
          </div>
          {row.notes ? <p className="text-sm text-muted">{row.notes}</p> : null}
        </div>
      ) : <p className="text-sm text-muted">Loading customer…</p>}
    </Sheet>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div>{value || '—'}</div>
    </div>
  )
}
