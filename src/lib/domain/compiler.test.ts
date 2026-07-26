import { describe, expect, it } from 'vitest'
import { compileSession, defaultConnectorMeters, workMetersFor } from './compiler'

describe('workMetersFor', () => {
  it('sums reps plus half-rep jog recoveries between them', () => {
    // 6 × 800m + 5 jog recoveries of 400m = 4800 + 2000
    expect(
      workMetersFor({ type: 'intervals', reps: 6, repMeters: 800, recovery: 'jog' }),
    ).toBe(6800)
  })

  it('static recovery adds no distance', () => {
    expect(
      workMetersFor({ type: 'intervals', reps: 12, repMeters: 400, recovery: 'static' }),
    ).toBe(4800)
  })

  it('hill reps count the jog back down', () => {
    // 8 × 300m up + 8 × 300m back down
    expect(workMetersFor({ type: 'hills', reps: 8, hillMeters: 300 })).toBe(4800)
  })
})

describe('defaultConnectorMeters', () => {
  it('is 15% of work distance within a 1–2km clamp', () => {
    expect(defaultConnectorMeters(10000)).toBe(1500)
    expect(defaultConnectorMeters(2000)).toBe(1000) // floor
    expect(defaultConnectorMeters(40000)).toBe(2000) // ceiling
  })
})

describe('compileSession', () => {
  it('compiles an easy run to a single continuous phase with no connectors', () => {
    const plan = compileSession({ type: 'easy', distanceMeters: 8000 })
    expect(plan.phases).toHaveLength(1)
    expect(plan.phases[0].kind).toBe('work')
    expect(plan.phases[0].targetMeters).toBe(8000)
    expect(plan.phases[0].requirements).not.toBeNull()
    expect(plan.workPattern).toBe('continuous')
    expect(plan.totalMeters).toBe(8000)
  })

  it('compiles long runs the same single-phase way', () => {
    const plan = compileSession({ type: 'long', distanceMeters: 20000 })
    expect(plan.phases).toHaveLength(1)
    expect(plan.totalMeters).toBe(20000)
  })

  it('compiles intervals to warmup → work → cooldown with relaxed connectors', () => {
    const plan = compileSession({
      type: 'intervals',
      reps: 6,
      repMeters: 800,
      recovery: 'jog',
    })
    expect(plan.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
    expect(plan.phases[0].requirements).toBeNull()
    expect(plan.phases[2].requirements).toBeNull()
    expect(plan.phases[1].targetMeters).toBe(6800)
    expect(plan.phases[1].requirements?.minUninterruptedMeters).toBe(800)
    expect(plan.workPattern).toBe('laps')
    // connector = clamp(6800 * 0.15) = 1020 each way
    expect(plan.totalMeters).toBe(6800 + 2 * 1020)
  })

  it('honors an explicit connector override', () => {
    const plan = compileSession(
      { type: 'intervals', reps: 6, repMeters: 800, recovery: 'jog' },
      { connectorMeters: 2500 },
    )
    expect(plan.phases[0].targetMeters).toBe(2500)
    expect(plan.totalMeters).toBe(6800 + 5000)
  })

  it('tempo is continuous, not laps', () => {
    const plan = compileSession({ type: 'tempo', tempoMeters: 5000 })
    expect(plan.workPattern).toBe('continuous')
    expect(plan.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
  })

  it('hills run as laps of the hill', () => {
    const plan = compileSession({ type: 'hills', reps: 8, hillMeters: 300 })
    expect(plan.workPattern).toBe('laps')
    expect(plan.phases[1].requirements?.minAvgGradientPercent).toBe(4)
  })
})

describe('input validation', () => {
  it('throws when intervals reps is 0', () => {
    expect(() =>
      workMetersFor({ type: 'intervals', reps: 0, repMeters: 800, recovery: 'jog' }),
    ).toThrow(/reps/)
  })

  it('throws when distanceMeters is negative', () => {
    expect(() => compileSession({ type: 'easy', distanceMeters: -100 })).toThrow(
      /distanceMeters/,
    )
  })

  it('throws when repMeters is NaN', () => {
    expect(() =>
      compileSession({ type: 'intervals', reps: 6, repMeters: NaN, recovery: 'jog' }),
    ).toThrow(/repMeters/)
  })

  it('throws when an explicit connectorMeters override is zero', () => {
    expect(() =>
      compileSession(
        { type: 'intervals', reps: 6, repMeters: 800, recovery: 'jog' },
        { connectorMeters: 0 },
      ),
    ).toThrow(/connectorMeters/)
  })

  it('compiles a single rep with no recovery distance (boundary case)', () => {
    expect(
      workMetersFor({ type: 'intervals', reps: 1, repMeters: 800, recovery: 'jog' }),
    ).toBe(800)

    const plan = compileSession({
      type: 'intervals',
      reps: 1,
      repMeters: 800,
      recovery: 'jog',
    })
    expect(plan.phases[1].targetMeters).toBe(800)
  })
})
