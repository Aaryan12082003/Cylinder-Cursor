// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
})
