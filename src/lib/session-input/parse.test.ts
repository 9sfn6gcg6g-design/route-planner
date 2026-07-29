import { describe, expect, it } from 'vitest'
import { parseSessionForm, type SessionFormValues } from './parse'

const base: SessionFormValues = {
  type: 'easy',
  distanceKm: '',
  tempoKm: '',
  reps: '',
  repMeters: '',
  recovery: 'jog',
  hillMeters: '',
}

describe('parseSessionForm', () => {
  it('builds an easy session, converting km to meters', () => {
    const result = parseSessionForm({ ...base, type: 'easy', distanceKm: '5' })
    expect(result).toEqual({ ok: true, session: { type: 'easy', distanceMeters: 5000 } })
  })

  it('builds a long session in meters', () => {
    const result = parseSessionForm({ ...base, type: 'long', distanceKm: '16.1' })
    expect(result).toEqual({ ok: true, session: { type: 'long', distanceMeters: 16100 } })
  })

  it('builds a tempo session from tempoKm', () => {
    const result = parseSessionForm({ ...base, type: 'tempo', tempoKm: '5' })
    expect(result).toEqual({ ok: true, session: { type: 'tempo', tempoMeters: 5000 } })
  })

  it('builds an intervals session with reps, rep meters, and recovery', () => {
    const result = parseSessionForm({
      ...base,
      type: 'intervals',
      reps: '6',
      repMeters: '800',
      recovery: 'static',
    })
    expect(result).toEqual({
      ok: true,
      session: { type: 'intervals', reps: 6, repMeters: 800, recovery: 'static' },
    })
  })

  it('builds a hills session with reps and hill meters', () => {
    const result = parseSessionForm({ ...base, type: 'hills', reps: '8', hillMeters: '150' })
    expect(result).toEqual({
      ok: true,
      session: { type: 'hills', reps: 8, hillMeters: 150 },
    })
  })

  it('reports a friendly error for a missing distance', () => {
    const result = parseSessionForm({ ...base, type: 'easy', distanceKm: '' })
    expect(result).toEqual({ ok: false, errors: { distanceKm: 'Required' } })
  })

  it('rejects non-numeric and non-positive distances', () => {
    expect(parseSessionForm({ ...base, type: 'easy', distanceKm: 'abc' })).toEqual({
      ok: false,
      errors: { distanceKm: 'Enter a number' },
    })
    expect(parseSessionForm({ ...base, type: 'easy', distanceKm: '0' })).toEqual({
      ok: false,
      errors: { distanceKm: 'Must be greater than 0' },
    })
  })

  it('requires reps to be a whole number >= 1', () => {
    expect(parseSessionForm({ ...base, type: 'intervals', reps: '2.5', repMeters: '800' })).toEqual(
      { ok: false, errors: { reps: 'Enter a whole number' } },
    )
    expect(parseSessionForm({ ...base, type: 'intervals', reps: '0', repMeters: '800' })).toEqual({
      ok: false,
      errors: { reps: 'Must be at least 1' },
    })
  })

  it('collects errors for every invalid field at once', () => {
    const result = parseSessionForm({ ...base, type: 'intervals', reps: '', repMeters: '' })
    expect(result).toEqual({
      ok: false,
      errors: { reps: 'Required', repMeters: 'Required' },
    })
  })
})
