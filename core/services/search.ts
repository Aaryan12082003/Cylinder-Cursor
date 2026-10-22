import type { SearchHit } from '@shared/types'
import type { AppContext } from '../db/database'
import { rows } from '../db/database'
import { likePattern } from './text'

export function globalSearch(ctx: AppContext, query: string): SearchHit[] {
  const text = query.trim()
  if (text.length < 1) return []
  const pattern = likePattern(text)
  const customers = rows<{ id: number; code: string; party_name: string; mobile: string | null }>(
    ctx,
    `SELECT id, code, party_name, mobile FROM customers
     WHERE lower(party_name) LIKE ? ESCAPE '\\'
        OR lower(code) LIKE ? ESCAPE '\\'
        OR lower(coalesce(mobile, '')) LIKE ? ESCAPE '\\'
        OR lower(coalesce(gst_number, '')) LIKE ? ESCAPE '\\'
        OR lower(coalesce(contact_person, '')) LIKE ? ESCAPE '\\'
     ORDER BY party_name COLLATE NOCASE
     LIMIT 8`,
    [pattern, pattern, pattern, pattern, pattern],
  )
  const dispatches = rows<{ id: number; number: string; party_name: string; challan_number: string | null }>(
    ctx,
    `SELECT d.id, d.number, c.party_name, d.challan_number
     FROM dispatches d JOIN customers c ON c.id = d.customer_id
     WHERE lower(d.number) LIKE ? ESCAPE '\\'
        OR lower(coalesce(d.challan_number, '')) LIKE ? ESCAPE '\\'
     ORDER BY d.id DESC
     LIMIT 8`,
    [pattern, pattern],
  )
  const returns = rows<{ id: number; number: string; party_name: string; challan_reference: string | null }>(
    ctx,
    `SELECT r.id, r.number, c.party_name, r.challan_reference
     FROM returns r JOIN customers c ON c.id = r.customer_id
     WHERE lower(r.number) LIKE ? ESCAPE '\\'
        OR lower(coalesce(r.challan_reference, '')) LIKE ? ESCAPE '\\'
     ORDER BY r.id DESC
     LIMIT 8`,
    [pattern, pattern],
  )
  return [
    ...customers.map((row) => ({
      kind: 'customer' as const,
      id: row.id,
      title: row.party_name,
      subtitle: `${row.code}${row.mobile ? ` · ${row.mobile}` : ''}`,
      href: `/customers?open=${row.id}`,
    })),
    ...dispatches.map((row) => ({
      kind: 'dispatch' as const,
      id: row.id,
      title: row.number,
      subtitle: `${row.party_name}${row.challan_number ? ` · ${row.challan_number}` : ''}`,
      href: `/dispatch?open=${row.id}`,
    })),
    ...returns.map((row) => ({
      kind: 'return' as const,
      id: row.id,
      title: row.number,
      subtitle: `${row.party_name}${row.challan_reference ? ` · ${row.challan_reference}` : ''}`,
      href: `/returns?open=${row.id}`,
    })),
  ]
}
