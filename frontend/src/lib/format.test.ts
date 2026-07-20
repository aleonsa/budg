import { describe, expect, it } from 'vitest'
import { centsToInput, formatMoney, formatMoneyCompact, toCents } from './format'

describe('money formatting', () => {
  it('formats MXN and USD cents without losing precision', () => {
    expect(formatMoney(199_990)).toBe('$1,999.90')
    expect(formatMoney(199_990, 'USD')).toBe('US$1,999.90')
  })

  it('formats large amounts compactly', () => {
    expect(formatMoneyCompact(1_250_000)).toBe('$12.5 k')
  })

  it('converts user input to cents', () => {
    expect(toCents('$1,234.56')).toBe(123_456)
    expect(toCents('-19.995')).toBe(-2_000)
    expect(toCents('10.075')).toBe(1_008)
    expect(toCents('-10.075')).toBe(-1_008)
    expect(toCents('not a number')).toBe(0)
  })

  it('converts cents to fixed decimal input', () => {
    expect(centsToInput(1_999)).toBe('19.99')
  })
})
