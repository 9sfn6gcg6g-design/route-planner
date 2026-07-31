import { describe, expect, it } from 'vitest'
import { parseSessionForm } from '.'

/** Pins the pillar's public seam: the barrel exposes the validation entry point. */
describe('session-input seam', () => {
  it('re-exports parseSessionForm', () => {
    expect(typeof parseSessionForm).toBe('function')
  })
})
