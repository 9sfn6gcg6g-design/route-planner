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
  targetPace: '5:00',
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

  it('builds a single-block tempo session with reps, block km, and pace', () => {
    const result = parseSessionForm({ ...base, type: 'tempo', tempoKm: '5', reps: '1' })
    expect(result).toEqual({
      ok: true,
      session: {
        type: 'tempo',
        reps: 1,
        tempoMeters: 5000,
        recovery: 'jog',
        targetPaceSecondsPerKm: 300,
      },
    })
  })

  it('builds a multi-rep tempo session', () => {
    const result = parseSessionForm({
      ...base,
      type: 'tempo',
      tempoKm: '2',
      reps: '3',
      recovery: 'jog',
      targetPace: '4:45',
    })
    expect(result).toEqual({
      ok: true,
      session: {
        type: 'tempo',
        reps: 3,
        tempoMeters: 2000,
        recovery: 'jog',
        targetPaceSecondsPerKm: 285,
      },
    })
  })

  it('builds an intervals session with reps, rep meters, recovery, and pace', () => {
    const result = parseSessionForm({
      ...base,
      type: 'intervals',
      reps: '6',
      repMeters: '800',
      recovery: 'static',
      targetPace: '4:30',
    })
    expect(result).toEqual({
      ok: true,
      session: {
        type: 'intervals',
        reps: 6,
        repMeters: 800,
        recovery: 'static',
        targetPaceSecondsPerKm: 270,
      },
    })
  })

  it('builds a hills session with reps, hill meters, and pace', () => {
    const result = parseSessionForm({ ...base, type: 'hills', reps: '8', hillMeters: '150' })
    expect(result).toEqual({
      ok: true,
      session: { type: 'hills', reps: 8, hillMeters: 150, targetPaceSecondsPerKm: 300 },
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

  it('parses mm:ss pace into seconds per km', () => {
    const result = parseSessionForm({ ...base, type: 'tempo', tempoKm: '5', reps: '1', targetPace: '5:10' })
    expect(result).toEqual({
      ok: true,
      session: {
        type: 'tempo',
        reps: 1,
        tempoMeters: 5000,
        recovery: 'jog',
        targetPaceSecondsPerKm: 310,
      },
    })
  })

  it('rejects a malformed pace with a friendly error', () => {
    expect(parseSessionForm({ ...base, type: 'tempo', tempoKm: '5', reps: '1', targetPace: '5.10' })).toEqual({
      ok: false,
      errors: { targetPace: 'Enter pace as mm:ss (e.g. 5:10)' },
    })
    expect(parseSessionForm({ ...base, type: 'tempo', tempoKm: '5', reps: '1', targetPace: '' })).toEqual({
      ok: false,
      errors: { targetPace: 'Required' },
    })
  })
})
