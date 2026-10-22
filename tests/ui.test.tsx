// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '../src/components/ui'
import { initials } from '../src/lib/utils'

describe('interface helpers', () => {
  it('builds initials for party names', () => {
    expect(initials('ABC Industries')).toBe('AI')
    expect(initials('  ')).toBe('CF')
  })

  it('renders an empty state the operator can act on', () => {
    render(<EmptyState icon={<span>box</span>} title="No customers yet" body="Add a party to start dispatching." />)
    expect(screen.getByRole('heading', { name: 'No customers yet' })).toBeTruthy()
    expect(screen.getByText('Add a party to start dispatching.')).toBeTruthy()
  })
})
