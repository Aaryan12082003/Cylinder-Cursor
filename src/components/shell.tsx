import { useQuery } from '@tanstack/react-query'
import {
  Bell,
  BookOpen,
  Boxes,
  ChevronsLeft,
  DatabaseBackup,
  LayoutDashboard,
  PanelLeft,
  Scale,
  ScrollText,
  Search,
  Settings,
  Truck,
  Undo2,
  Users,
  MapPinned,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, onAppEvent } from '@/lib/api'
import { cn, initials } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const groups = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/inventory', label: 'Cylinder Inventory', icon: Boxes },
      { to: '/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/dispatch', label: 'Dispatch Cylinders', icon: Truck },
      { to: '/returns', label: 'Receive Cylinders', icon: Undo2 },
      { to: '/routes', label: 'Routes', icon: MapPinned },
      { to: '/ledger', label: 'Cylinder Ledger', icon: BookOpen },
      { to: '/outstanding', label: 'Outstanding', icon: Scale },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: ScrollText },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/backup', label: 'Backup & Restore', icon: DatabaseBackup },
      { to: '/audit', label: 'Audit Logs', icon: ScrollText },
    ],
  },
]

const crumbs: Record<string, string> = {
  '/': 'Dashboard',
  '/inventory': 'Cylinder Inventory',
  '/customers': 'Customers',
  '/dispatch': 'Dispatch',
  '/returns': 'Receive',
  '/routes': 'Routes',
  '/ledger': 'Ledger',
  '/outstanding': 'Outstanding',
  '/reports': 'Reports',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
  '/backup': 'Backup & Restore',
  '/audit': 'Audit Logs',
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3', compact && 'justify-center')}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-white">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="6" rx="6" ry="2.4" />
          <path d="M6 6v12c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V6" />
          <path d="M6 12c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4" />
        </svg>
      </div>
      {compact ? null : (
        <div>
          <div className="text-sm font-semibold tracking-tight">CylinderFlow</div>
          <div className="text-[11px] text-muted">Inventory desk</div>
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const collapsed = useUi((state) => state.collapsed)
  const toggle = useUi((state) => state.toggleCollapsed)
  const setPalette = useUi((state) => state.setPaletteOpen)
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [narrow, setNarrow] = useState(false)
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCount, refetchInterval: 30_000 })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const compact = collapsed || narrow

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1180)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.data?.theme === 'dark')
  }, [settings.data?.theme])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(true)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPalette, toggle])

  useEffect(() => onAppEvent(() => {
    qc.invalidateQueries()
    toast.info('A month-end cylinder report is ready')
  }), [qc])

  const crumb = crumbs[location.pathname] ?? 'CylinderFlow'

  return (
    <div className="flex h-full bg-background text-foreground">
      <aside className={cn('flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200', compact ? 'w-[76px]' : 'w-[250px]')}>
        <div className={cn('flex h-16 items-center border-b border-border px-4', compact && 'justify-center px-2')}>
          <Logo compact={compact} />
        </div>
        <nav className="flex-1 space-y-5 overflow-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.label}>
              {compact ? null : <div className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-muted">{group.label}</div>}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-600 hover:bg-background',
                        compact && 'justify-center',
                        isActive && 'bg-primary-soft text-primary',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {compact ? null : <span className="truncate">{item.label}</span>}
                    {!compact && item.to === '/notifications' && (unread.data?.count ?? 0) > 0 ? (
                      <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] text-white">{unread.data?.count}</span>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <button className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-background', compact && 'justify-center')} onClick={() => navigate('/settings')}>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {initials(settings.data?.operatorName || 'Administrator')}
            </div>
            {compact ? null : (
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{settings.data?.operatorName || 'Administrator'}</div>
                <div className="truncate text-[11px] text-muted">{settings.data?.company.name || 'Local operator'}</div>
              </div>
            )}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-background" onClick={toggle} aria-label="Collapse sidebar">
            {compact ? <PanelLeft className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
          <div className="text-sm text-muted">
            <span>CylinderFlow</span>
            <span className="mx-2 text-border">/</span>
            <span className="font-medium text-foreground">{crumb}</span>
          </div>
          <button
            className="ml-auto flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted"
            onClick={() => setPalette(true)}
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search customers, challans, documents</span>
            <kbd className="rounded border border-border bg-surface px-1.5 text-[11px]">Ctrl K</kbd>
          </button>
          <button className="relative rounded-lg p-2 text-muted hover:bg-background" onClick={() => navigate('/notifications')} aria-label="Notifications">
            <Bell className="h-4 w-4" />
            {(unread.data?.count ?? 0) > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" /> : null}
          </button>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials(settings.data?.operatorName || 'A')}
          </div>
        </header>
        {settings.data?.demoLoaded ? (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
            Demonstration data is loaded. Remove it from Settings before entering real business records.
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}

function CommandPalette() {
  const open = useUi((state) => state.paletteOpen)
  const setOpen = useUi((state) => state.setPaletteOpen)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useQuery({ queryKey: ['search', query], queryFn: () => api.search(query), enabled: open && query.trim().length > 0 })
  const nav = useMemo(
    () =>
      groups
        .flatMap((group) => group.items)
        .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
        .map((item) => ({ title: item.label, subtitle: 'Go to page', href: item.to })),
    [query],
  )
  const hits = [...nav, ...(results.data ?? []).map((hit) => ({ title: hit.title, subtitle: hit.subtitle, href: hit.href }))]

  useEffect(() => {
    setActive(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((value) => Math.min(hits.length - 1, value + 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((value) => Math.max(0, value - 1))
      }
      if (event.key === 'Enter' && hits[active]) {
        navigate(hits[active].href)
        setOpen(false)
        setQuery('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, hits, active, navigate, setOpen])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30" onClick={() => setOpen(false)}>
      <div className="mx-auto mt-24 w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-card" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search or jump to a page"
          className="h-12 w-full border-b border-border px-4 text-sm outline-none"
        />
        <div className="max-h-80 overflow-auto p-2">
          {hits.length === 0 ? <div className="px-3 py-8 text-center text-sm text-muted">No matching records.</div> : null}
          {hits.map((hit, index) => (
            <button
              key={`${hit.href}-${hit.title}`}
              className={cn('flex w-full flex-col rounded-lg px-3 py-2 text-left', index === active && 'bg-primary-soft')}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                navigate(hit.href)
                setOpen(false)
                setQuery('')
              }}
            >
              <span className="text-sm font-medium">{hit.title}</span>
              <span className="text-xs text-muted">{hit.subtitle}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
