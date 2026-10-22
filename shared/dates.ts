import { differenceInCalendarDays } from 'date-fns'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function todayIso(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function nowIso(now = new Date()): string {
  return now.toISOString()
}

export function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function formatDateOnly(iso: string | null | undefined, pattern = 'dd MMM yyyy'): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return '—'
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const mon = MONTHS_SHORT[m - 1] ?? ''
  const month = MONTHS[m - 1] ?? ''
  if (pattern === 'dd/MM/yyyy') return `${dd}/${mm}/${y}`
  if (pattern === 'yyyy-MM-dd') return `${y}-${mm}-${dd}`
  if (pattern === 'dd MMMM yyyy') return `${dd} ${month} ${y}`
  return `${dd} ${mon} ${y}`
}

export function formatTimestamp(iso: string | null | undefined, pattern = 'dd MMM yyyy'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return formatDateOnly(iso, pattern)
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${formatDateOnly(todayIso(date), pattern)} ${hh}:${min}`
}

export function daysBetween(laterIso: string, earlierIso: string): number {
  return differenceInCalendarDays(parseDateOnly(laterIso), parseDateOnly(earlierIso))
}

export function monthKey(now = new Date()): string {
  return todayIso(now).slice(0, 7)
}

export function lastDayOfMonth(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number)
  const date = new Date(y, m, 0)
  return todayIso(date)
}

export function periodLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1] ?? ''} ${y}`
}

export function shiftMonth(periodKey: string, delta: number): string {
  const [y, m] = periodKey.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  return monthKey(date)
}

export function monthsBetweenInclusive(startKey: string, endKey: string): string[] {
  const keys: string[] = []
  let cursor = startKey
  while (cursor <= endKey) {
    keys.push(cursor)
    cursor = shiftMonth(cursor, 1)
    if (keys.length > 240) break
  }
  return keys
}

export function recentMonthKeys(now: Date, count: number): { key: string; label: string }[] {
  const current = monthKey(now)
  const start = shiftMonth(current, -(count - 1))
  return monthsBetweenInclusive(start, current).map((key) => {
    const [y, m] = key.split('-').map(Number)
    return { key, label: `${MONTHS_SHORT[(m || 1) - 1]} ${String(y).slice(2)}` }
  })
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value || 0)
}
