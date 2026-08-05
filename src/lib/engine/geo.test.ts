import { describe, expect, it } from 'vitest'
import {
  angularDifferenceDegrees,
  bearingDegrees,
  classifyTurn,
  cumulativeMeters,
  haversineMeters,
  pathLengthMeters,
  signedTurnDegrees,
  turnFlowScores,
  turnSmoothness,
} from './geo'

describe('turnSmoothness (decision 18)', () => {
  it('a gentle sweep is fully smooth; a hairpin is not; sign is irrelevant', () => {
    expect(turnSmoothness(20)).toBe(1)
    expect(turnSmoothness(-20)).toBe(1)
    expect(turnSmoothness(135)).toBe(0)
    expect(turnSmoothness(90)).toBe(turnSmoothness(-90))
    expect(turnSmoothness(90)).toBeGreaterThan(0)
    expect(turnSmoothness(90)).toBeLessThan(1)
  })

  it('decays monotonically between gentle and sharp', () => {
    expect(turnSmoothness(60)).toBeGreaterThan(turnSmoothness(100))
  })
})

describe('turnFlowScores (decision 18)', () => {
  it('no turns is perfectly smooth and legible', () => {
    expect(turnFlowScores([], 1000)).toEqual({ turnSmoothness: 1, turnDensity: 1 })
  })

  it('one hairpin drags smoothness down; gentle sweeps do not count as navigational turns', () => {
    expect(turnFlowScores([10, 15, -20], 1000).turnDensity).toBe(1) // all below the gentle threshold
    expect(turnFlowScores([130], 1000).turnSmoothness).toBeLessThan(0.1)
  })

  it('more navigational turns per km lowers density', () => {
    const few = turnFlowScores([90, 90], 2000).turnDensity
    const many = turnFlowScores([90, 90, 90, 90, 90, 90], 2000).turnDensity
    expect(many).toBeLessThan(few)
  })
})

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

describe('signedTurnDegrees', () => {
  it('is negative for a left turn, positive for a right turn', () => {
    expect(signedTurnDegrees(0, 90)).toBe(90) // heading north, leave east → right
    expect(signedTurnDegrees(0, 270)).toBe(-90) // heading north, leave west → left
    expect(signedTurnDegrees(0, 0)).toBe(0)
  })

  it('wraps across north', () => {
    expect(signedTurnDegrees(350, 10)).toBe(20) // slight right
    expect(signedTurnDegrees(10, 350)).toBe(-20) // slight left
  })

  it('represents a straight-back reversal at the ±180 boundary', () => {
    // Range is [-180, 180); an exact reversal lands on -180. Sign is
    // immaterial downstream — classifyTurn keys off magnitude.
    expect(Math.abs(signedTurnDegrees(0, 180))).toBe(180)
  })
})

describe('classifyTurn', () => {
  it('calls small deviations straight', () => {
    expect(classifyTurn(0, 0)).toBe('straight')
    expect(classifyTurn(0, 30)).toBe('straight')
    expect(classifyTurn(0, 330)).toBe('straight')
  })

  it('separates left from right by the sign of the turn', () => {
    expect(classifyTurn(0, 90)).toBe('right')
    expect(classifyTurn(0, 270)).toBe('left')
    expect(classifyTurn(90, 0)).toBe('left')
    expect(classifyTurn(90, 180)).toBe('right')
  })

  it('treats a near-reversal as doubling back', () => {
    expect(classifyTurn(0, 180)).toBe('back')
    expect(classifyTurn(0, 200)).toBe('back')
  })

  it('honours custom cone widths', () => {
    expect(classifyTurn(0, 50, 60)).toBe('straight')
    expect(classifyTurn(0, 50)).toBe('right')
  })
})
