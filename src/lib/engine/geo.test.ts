import { describe, expect, it } from 'vitest'
import { angularDifferenceDegrees, bearingDegrees, cumulativeMeters, haversineMeters, pathLengthMeters } from './geo'

describe('haversineMeters', () => {
  it('measures one degree of latitude as ~111.2km', () => {
    const d = haversineMeters({ lat: 51, lon: -2.5 }, { lat: 52, lon: -2.5 })
    expect(d).toBeGreaterThan(110_500)
    expect(d).toBeLessThan(111_500)
  })

  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 51.45, lon: -2.58 }, { lat: 51.45, lon: -2.58 })).toBe(0)
  })

  it('is symmetric', () => {
    const a = { lat: 51.4545, lon: -2.5879 }
    const b = { lat: 51.46, lon: -2.6 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})

describe('pathLengthMeters', () => {
  it('sums consecutive segment lengths', () => {
    const a = { lat: 51.45, lon: -2.58 }
    const b = { lat: 51.46, lon: -2.58 }
    const c = { lat: 51.47, lon: -2.58 }
    const direct = haversineMeters(a, b) + haversineMeters(b, c)
    expect(pathLengthMeters([a, b, c])).toBeCloseTo(direct, 6)
  })

  it('is zero for a single point or empty path', () => {
    expect(pathLengthMeters([{ lat: 51, lon: -2 }])).toBe(0)
    expect(pathLengthMeters([])).toBe(0)
  })
})

describe('cumulativeMeters', () => {
  it('starts at zero and ends at the total path length', () => {
    const pts = [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.46, lon: -2.58 },
      { lat: 51.47, lon: -2.58 },
    ]
    const cum = cumulativeMeters(pts)
    expect(cum).toHaveLength(3)
    expect(cum[0]).toBe(0)
    expect(cum[2]).toBeCloseTo(pathLengthMeters(pts), 6)
    expect(cum[1]).toBeGreaterThan(0)
    expect(cum[1]).toBeLessThan(cum[2])
  })
})

describe('bearingDegrees', () => {
  it('points north, east, and south correctly', () => {
    expect(bearingDegrees({ lat: 51, lon: -2.5 }, { lat: 52, lon: -2.5 })).toBeCloseTo(0, 0)
    expect(bearingDegrees({ lat: 51, lon: -2.5 }, { lat: 51, lon: -2.4 })).toBeCloseTo(90, 0)
    expect(bearingDegrees({ lat: 52, lon: -2.5 }, { lat: 51, lon: -2.5 })).toBeCloseTo(180, 0)
  })
})

describe('angularDifferenceDegrees', () => {
  it('wraps around the compass', () => {
    expect(angularDifferenceDegrees(350, 10)).toBe(20)
    expect(angularDifferenceDegrees(10, 350)).toBe(20)
    expect(angularDifferenceDegrees(90, 90)).toBe(0)
    expect(angularDifferenceDegrees(0, 180)).toBe(180)
  })
})
