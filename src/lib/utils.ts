import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'CF'
}

export function conditionLabel(value: string) {
  if (value === 'with_customer') return 'With customer'
  if (value === 'maintenance') return 'Maintenance'
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll('_', ' ')
}

export function typeLabel(value: string) {
  return value.replaceAll('_', ' ')
}
