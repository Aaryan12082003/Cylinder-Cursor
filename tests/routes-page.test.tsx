// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoutesPage } from '../src/pages/RoutesPage'
import { api } from '../src/lib/api'
import type { AppSettings, RouteDetail } from '@shared/types'

vi.mock('../src/lib/api', () => ({
  api: {
    settings: vi.fn(),
    routeDetail: vi.fn(),
    createRoute: vi.fn(),
    deleteRoute: vi.fn(),
    updateRoute: vi.fn(),
  },
}))

const settings = { routes: [{ id: 1, name: 'North route', isActive: true, createdAt: '', updatedAt: '' }] } as AppSettings
const routeDetail: RouteDetail = { route: { id: 1, name: 'North route', isActive: true }, holdings: [], history: [] }

describe('RoutesPage', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.mocked(api.settings).mockResolvedValue(settings)
  })

  it('keeps the detail search input mounted while a new search is loading', async () => {
    let resolveSearch!: (value: RouteDetail) => void
    const pendingSearch = new Promise<RouteDetail>((resolve) => { resolveSearch = resolve })
    vi.mocked(api.routeDetail).mockImplementation((payload) => {
      const search = (payload as { search?: string }).search
      return search ? pendingSearch : Promise.resolve(routeDetail)
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><RoutesPage /></QueryClientProvider>)

    const input = await screen.findByPlaceholderText('Search customer, cylinder size, serial, or challan')
    input.focus()
    fireEvent.change(input, { target: { value: 'acme' } })

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search customer, cylinder size, serial, or challan')).toBe(input)
      expect(document.activeElement).toBe(input)
    })

    resolveSearch(routeDetail)
  })

  it('does not show the previous route while a newly selected route is loading', async () => {
    const twoRoutes = {
      routes: [
        { id: 1, name: 'North route', isActive: true, createdAt: '', updatedAt: '' },
        { id: 2, name: 'South route', isActive: true, createdAt: '', updatedAt: '' },
      ],
    } as AppSettings
    vi.mocked(api.settings).mockResolvedValue(twoRoutes)
    let resolveSouth!: (value: RouteDetail) => void
    const pendingSouth = new Promise<RouteDetail>((resolve) => { resolveSouth = resolve })
    vi.mocked(api.routeDetail).mockImplementation((payload) => {
      const routeId = (payload as { routeId: number }).routeId
      return routeId === 1 ? Promise.resolve(routeDetail) : pendingSouth
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><RoutesPage /></QueryClientProvider>)

    await screen.findByRole('heading', { name: 'North route' })
    fireEvent.click(screen.getByRole('button', { name: /South route/ }))

    await waitFor(() => {
      expect(api.routeDetail).toHaveBeenCalledWith({ routeId: 2, search: '' })
      expect(screen.queryByRole('heading', { name: 'North route' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
      expect(screen.queryByText('Cylinders currently held')).toBeNull()
    })

    resolveSouth({ route: { id: 2, name: 'South route', isActive: true }, holdings: [], history: [] })
    await screen.findByRole('heading', { name: 'South route' })
    expect(screen.getByText('No current cylinders are associated with this route.')).toBeTruthy()
  })

  it('shows assigned customers even when the route has no movement history', async () => {
    vi.mocked(api.routeDetail).mockResolvedValue({
      ...routeDetail,
      customers: [{ customerId: 42, customerCode: 'CUST-42', customerName: 'No-history customer', mobile: '9876543210', city: 'Jaipur', status: 'active', totalOutstanding: 0 }],
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><RoutesPage /></QueryClientProvider>)

    expect(await screen.findByText('No-history customer')).toBeTruthy()
    expect(screen.queryByText('No customers are assigned to this route.')).toBeNull()
  })

  it('filters assigned customers by code and city on the existing search', async () => {
    vi.mocked(api.routeDetail).mockResolvedValue({
      ...routeDetail,
      customers: [
        { customerId: 42, customerCode: 'CUST-42', customerName: 'Jaipur Gas', mobile: '9876543210', city: 'Jaipur', status: 'active', totalOutstanding: 4 },
        { customerId: 43, customerCode: 'CUST-43', customerName: 'Delhi Gas', mobile: '9876543211', city: 'Delhi', status: 'active', totalOutstanding: 0 },
      ],
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><RoutesPage /></QueryClientProvider>)

    const input = await screen.findByPlaceholderText('Search customer, cylinder size, serial, or challan')
    fireEvent.change(input, { target: { value: 'CUST-42' } })
    await waitFor(() => {
      expect(screen.getByText('Jaipur Gas')).toBeTruthy()
      expect(screen.getByText('4')).toBeTruthy()
      expect(screen.queryByText('Delhi Gas')).toBeNull()
    })

    fireEvent.change(input, { target: { value: 'Delhi' } })
    await waitFor(() => {
      expect(screen.getByText('Delhi Gas')).toBeTruthy()
      expect(screen.queryByText('Jaipur Gas')).toBeNull()
    })
  })

  it('keeps the customer visible when search only matches holding or history details', async () => {
    vi.mocked(api.routeDetail).mockResolvedValue({
      ...routeDetail,
      customers: [{ customerId: 42, customerCode: 'CUST-42', customerName: 'Route customer', mobile: '', city: '', status: 'active', totalOutstanding: 2 }],
      holdings: [{ customerId: 42, customerName: 'Route customer', mobile: '', sizeName: '23 Ltr', serialNumbers: ['SER-23'], quantity: 2 }],
      history: [{ id: 7, type: 'dispatch', number: 'DSP-7', date: '2026-10-27', customerName: 'Route customer', quantity: 2, challan: 'CHALLAN-7', reversed: false }],
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><RoutesPage /></QueryClientProvider>)
    const input = await screen.findByPlaceholderText('Search customer, cylinder size, serial, or challan')

    fireEvent.change(input, { target: { value: 'SER-23' } })
    await waitFor(() => expect(screen.getAllByText('Route customer').length).toBeGreaterThan(0))
    fireEvent.change(input, { target: { value: 'CHALLAN-7' } })
    await waitFor(() => expect(screen.getAllByText('Route customer').length).toBeGreaterThan(0))
  })
})
