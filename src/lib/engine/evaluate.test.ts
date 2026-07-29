import { describe, expect, it } from 'vitest'
import type { TerrainRequirements } from '@/lib/domain/types'
import { chainMinQuietness, evaluateChain } from './evaluate'
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

describe('scoring', () => {
  it('prefers quieter chains, all else equal', () => {
    const quiet = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.3)
    const louder = evaluateChain(chain([edge(1000, 0.7, 'paved')]), intervals, 0.3)
    expect(quiet.score).toBeGreaterThan(louder.score)
  })

  it('prefers flatter chains for flat sessions and steeper for hills', () => {
    const flat = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.2)
    const rolling = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.9)
    expect(flat.score).toBeGreaterThan(rolling.score)

    const steep = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 9)
    const gentle = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 5)
    expect(steep.score).toBeGreaterThan(gentle.score)
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
})
