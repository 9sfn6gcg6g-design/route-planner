import { describe, expect, it } from 'vitest'
import type { TerrainRequirements } from '@/lib/domain/types'
import { chainMeanQuietness, chainMinQuietness, evaluateChain, segmentQuality } from './evaluate'
import type { Chain, RunEdge, SurfaceKind } from './types'

function edge(lengthMeters: number, quietness: number, surface: SurfaceKind): RunEdge {
  return {
    wayId: 1,
    fromNodeId: 1,
    toNodeId: 2,
    points: [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.46, lon: -2.58 },
    ],
    lengthMeters,
    highway: 'residential',
    quietness,
    surface,
  }
}

function chain(edges: RunEdge[]): Chain {
  return {
    edges,
    points: edges.flatMap((e) => e.points),
    lengthMeters: edges.reduce((s, e) => s + e.lengthMeters, 0),
    startNodeId: 1,
    endNodeId: 2,
    isCycle: false,
    toleratedJunctionNodeIds: [],
  }
}

const intervals: TerrainRequirements = {
  maxAvgGradientPercent: 1,
  minAvgGradientPercent: null,
  maxJunctionsPerKm: 6,
  minQuietness: 0.7,
  surface: 'paved',
  minUninterruptedMeters: 800,
}

const hills: TerrainRequirements = {
  maxAvgGradientPercent: 15,
  minAvgGradientPercent: 4,
  maxJunctionsPerKm: 6,
  minQuietness: 0.5,
  surface: 'any',
  minUninterruptedMeters: 300,
}

describe('chainMinQuietness', () => {
  it('is the minimum over edges', () => {
    expect(chainMinQuietness(chain([edge(100, 0.9, 'paved'), edge(100, 0.6, 'paved')]))).toBe(0.6)
  })
})

describe('chainMeanQuietness (decision 17)', () => {
  it('is the length-weighted mean over edges', () => {
    // 300m at 0.9 and 100m at 0.5 → (0.9*300 + 0.5*100) / 400 = 0.8
    expect(chainMeanQuietness(chain([edge(300, 0.9, 'paved'), edge(100, 0.5, 'paved')]))).toBeCloseTo(
      0.8,
      10,
    )
  })
})

describe('evaluateChain — static checks (gradient null)', () => {
  it('passes a long quiet paved chain', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails a chain shorter than minUninterruptedMeters', () => {
    const result = evaluateChain(chain([edge(500, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/800/)
  })

  it('fails when any edge is louder than minQuietness', () => {
    const result = evaluateChain(chain([edge(600, 0.9, 'paved'), edge(600, 0.45, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/quietness/i)
  })

  it('fails closed: unknown surface does not satisfy a paved requirement', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'unknown')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/paved/i)
  })

  it('surface any accepts unpaved and unknown', () => {
    const result = evaluateChain(chain([edge(500, 0.9, 'unknown')]), hills, null)
    expect(result.passes).toBe(true)
  })
})

describe('evaluateChain — gradient checks', () => {
  it('fails intervals on a 3% gradient', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 3)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/gradient/i)
  })

  it('passes intervals on flat ground', () => {
    expect(evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.3).passes).toBe(true)
  })

  it('hills require climb: flat fails, steep passes', () => {
    const flat = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 0.5)
    expect(flat.passes).toBe(false)
    const steep = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 8)
    expect(steep.passes).toBe(true)
  })
})

describe('segmentQuality (decision 16)', () => {
  const base = {
    quietness: 0.9,
    gradientPercent: 0.3,
    wantsClimb: false,
    crossings: 0,
    lengthMeters: 1000,
    conversationalTargetMeters: null,
  }

  it('is a calibrated 0–1 score', () => {
    const q = segmentQuality(base)
    expect(q).toBeGreaterThan(0)
    expect(q).toBeLessThanOrEqual(1)
  })

  it('prefers quieter stretches, all else equal', () => {
    expect(segmentQuality({ ...base, quietness: 0.9 })).toBeGreaterThan(
      segmentQuality({ ...base, quietness: 0.7 }),
    )
  })

  it('prefers flatter for flat sessions and steeper for climbs', () => {
    expect(segmentQuality({ ...base, gradientPercent: 0.2 })).toBeGreaterThan(
      segmentQuality({ ...base, gradientPercent: 0.9 }),
    )
    const climb = {
      quietness: 0.9,
      wantsClimb: true,
      crossings: 0,
      lengthMeters: 1000,
      conversationalTargetMeters: null,
    }
    expect(segmentQuality({ ...climb, gradientPercent: 9 })).toBeGreaterThan(
      segmentQuality({ ...climb, gradientPercent: 5 }),
    )
  })

  it('prefers crossing-free stretches, all else equal', () => {
    expect(segmentQuality({ ...base, crossings: 0 })).toBeGreaterThan(
      segmentQuality({ ...base, crossings: 1 }),
    )
    expect(segmentQuality({ ...base, crossings: 1 })).toBeGreaterThan(
      segmentQuality({ ...base, crossings: 3 }),
    )
  })
})

describe('segmentQuality — conversational sessions (decision 17)', () => {
  const conv = {
    quietness: 0.9,
    gradientPercent: 0.3,
    wantsClimb: false,
    crossings: 0,
    lengthMeters: 2000,
    conversationalTargetMeters: 3000,
  }

  it('crossings carry no ranking penalty', () => {
    expect(segmentQuality({ ...conv, crossings: 3 })).toBe(segmentQuality(conv))
  })

  it('rewards stretches nearer the target length', () => {
    expect(segmentQuality({ ...conv, lengthMeters: 2500 })).toBeGreaterThan(
      segmentQuality({ ...conv, lengthMeters: 500 }),
    )
  })

  it('a long ordinary stretch outranks a tiny perfect loop', () => {
    const tinyPerfectLoop = { ...conv, quietness: 1, gradientPercent: 0, lengthMeters: 40 }
    const decentLongStretch = {
      ...conv,
      quietness: 0.7,
      gradientPercent: 1,
      lengthMeters: 2800,
      crossings: 2,
    }
    expect(segmentQuality(decentLongStretch)).toBeGreaterThan(segmentQuality(tinyPerfectLoop))
  })

  it('length-fit saturates at the target', () => {
    expect(segmentQuality({ ...conv, lengthMeters: 6000 })).toBe(
      segmentQuality({ ...conv, lengthMeters: 3000 }),
    )
  })

  it('judges gradient on a gentler curve than work stretches', () => {
    // At 4.3% the work flatness curve is nearly zero; a conversational run
    // barely notices rolling ground (terrain-tile noise must not crater it).
    const work = { ...conv, conversationalTargetMeters: null }
    const workDrop =
      segmentQuality({ ...work, gradientPercent: 0 }) -
      segmentQuality({ ...work, gradientPercent: 4.3 })
    const convDrop =
      segmentQuality({ ...conv, gradientPercent: 0 }) -
      segmentQuality({ ...conv, gradientPercent: 4.3 })
    expect(convDrop).toBeLessThan(workDrop / 2)
  })

  it('a long rolling stretch outranks a short flat one', () => {
    // The live BS1 5AU failure: 2067m at 4.3% ranked below 933m at 0.8%.
    const long = { ...conv, quietness: 0.7, gradientPercent: 4.3, lengthMeters: 2067 }
    const short = { ...conv, quietness: 0.9, gradientPercent: 0.8, lengthMeters: 933 }
    expect(segmentQuality(long)).toBeGreaterThan(segmentQuality(short))
  })
})

describe('junction density', () => {
  it('fails a chain with too many tolerated junctions per km', () => {
    const c = chain([edge(1000, 0.9, 'paved')])
    c.toleratedJunctionNodeIds = [1, 2, 3, 4, 5, 6, 7]
    const result = evaluateChain(c, intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/junction/i)
  })

  it('passes a chain with acceptable tolerated-junction density', () => {
    const c = chain([edge(1000, 0.9, 'paved')])
    c.toleratedJunctionNodeIds = [1, 2, 3]
    expect(evaluateChain(c, intervals, null).passes).toBe(true)
  })

  it('does not silently pass a zero-length chain (0/0 must not evaluate as an acceptable density)', () => {
    const result = evaluateChain(chain([edge(0, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/junction/i)
  })
})
