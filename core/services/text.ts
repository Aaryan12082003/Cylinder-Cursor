export function clean(value: string | null | undefined, max = 500): string {
  return (value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
}

export function nullIfEmpty(value: string | null | undefined, max = 500): string | null {
  const text = clean(value, max)
  return text ? text : null
}

export function likePattern(query: string): string {
  const escaped = query.trim().toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)
  return `%${escaped}%`
}

export function currencySymbol(code: string): string {
  if (code === 'USD') return '$'
  if (code === 'EUR') return '€'
  return '₹'
}
