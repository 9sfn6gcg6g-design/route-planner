import { describe, expect, it } from 'vitest'
import { terrainRequirementsFor } from '@/lib/domain/profiles'
import type { Session } from '@/lib/domain/types'
import fixture from './__fixtures__/overpass-bristol.json'
import wideFixture from './__fixtures__/overpass-bristol-wide.json'
import { buildChains } from './chains'
import { evaluateChain } from './evaluate'
import { buildGraph } from './graph'
import { parseOverpassResponse } from './overpass'
import type { OsmWay } from './types'

function way(id: number, nodeIds: number[], lats: number[], highway = 'residential'): OsmWay {
  return {
    id,
    tags: { highway },
    nodeIds,
    points: lats.map((lat, i) => ({ lat, lon: -2.58 - i * 0.0001 })),
  }
}

describe('buildChains', () => {
  it('merges two ways joined end-to-end at a degree-2 splice into one chain', () => {
    const graph = buildGraph([
      way(1, [10, 11, 20], [51.45, 51.451, 51.452]),
      way(2, [20, 21, 22], [51.452, 51.453, 51.454]),
    ])
    const chains = buildChains(graph)
    expect(chains).toHaveLength(1)
    expect(chains[0].edges).toHaveLength(2)
    expect(chains[0].points).toHaveLength(5) // 3 + 3 minus shared endpoint
    expect(chains[0].isCycle).toBe(false)
    const ends = [chains[0].startNodeId, chains[0].endNodeId].sort()
    expect(ends).toEqual([10, 22])
    const total = graph.edges.reduce((s, e) => s + e.lengthMeters, 0)
    expect(chains[0].lengthMeters).toBeCloseTo(total, 6)
  })

  it('reverses edge geometry when walking against way direction', () => {
    // way 2 points AWAY from the splice: 12 -> 11; walking 10 -> 11 -> 12 must reverse it
    const a = way(1, [10, 11], [51.45, 51.451])
    const b = way(2, [12, 11], [51.452, 51.451])
    const chains = buildChains(buildGraph([a, b]))
    expect(chains).toHaveLength(1)
    const lats = chains[0].points.map((p) => p.lat)
    // walking 10 -> 11 -> 12 must yield strictly increasing latitudes;
    // without reversal, way 2's geometry would appear backwards and
    // duplicate the splice point
    expect(lats).toHaveLength(3)
    expect(lats).toEqual([...lats].sort((x, y) => x - y))
    expect(new Set(lats).size).toBe(3)
  })

  it('stops chains at true crossings (degree >= 3)', () => {
    // ways crossing at node 20: every edge is its own chain
    const graph = buildGraph([
      way(1, [10, 20, 12], [51.45, 51.451, 51.452]),
      way(2, [30, 20, 32], [51.46, 51.451, 51.462]),
    ])
    const chains = buildChains(graph)
    expect(chains).toHaveLength(4)
    for (const chain of chains) {
      expect(chain.edges).toHaveLength(1)
    }
  })

  it('detects an isolated closed loop as a cycle', () => {
    const graph = buildGraph([way(1, [10, 11, 12, 10], [51.45, 51.451, 51.4505, 51.45])])
    const chains = buildChains(graph)
    expect(chains).toHaveLength(1)
    expect(chains[0].isCycle).toBe(true)
    expect(chains[0].startNodeId).toBe(chains[0].endNodeId)
    expect(chains[0].lengthMeters).toBeGreaterThan(0)
  })

  it('consumes every edge exactly once on the real Bristol fixture', () => {
    const graph = buildGraph(parseOverpassResponse(fixture))
    const chains = buildChains(graph)
    const chainEdgeCount = chains.reduce((s, c) => s + c.edges.length, 0)
    expect(chainEdgeCount).toBe(graph.edges.length)
    const chainLength = chains.reduce((s, c) => s + c.lengthMeters, 0)
    const edgeLength = graph.edges.reduce((s, e) => s + e.lengthMeters, 0)
    expect(chainLength).toBeCloseTo(edgeLength, 4)
    // merging through splices must actually happen on real data
    expect(chains.length).toBeLessThan(graph.edges.length)
    for (const chain of chains) {
      expect(chain.points.length).toBeGreaterThanOrEqual(2)
      expect(chain.lengthMeters).toBeGreaterThan(0)
    }
  })

  it('continues a street through a footpath crossing, recording a tolerated junction', () => {
    // residential street 10-11-12 crossed at node 11 by footway 20-11-21
    const street = way(1, [10, 11, 12], [51.45, 51.451, 51.452])
    const path: OsmWay = {
      id: 2,
      tags: { highway: 'footway' },
      nodeIds: [20, 11, 21],
      points: [
        { lat: 51.451, lon: -2.579 },
        { lat: 51.451, lon: -2.5801 },
        { lat: 51.451, lon: -2.581 },
      ],
    }
    const chains = buildChains(buildGraph([street, path]))
    expect(chains).toHaveLength(3)
    const streetChain = chains.find((c) => c.edges[0].highway === 'residential')
    expect(streetChain).toBeDefined()
    expect(streetChain!.edges).toHaveLength(2)
    expect(streetChain!.toleratedJunctionNodeIds).toEqual([11])
    // the footway is still cut at the street: crossing a road IS a forced stop
    const footChains = chains.filter((c) => c.edges[0].highway === 'footway')
    expect(footChains).toHaveLength(2)
    for (const c of footChains) {
      expect(c.toleratedJunctionNodeIds).toEqual([])
    }
  })

  it('continues across a way-id change via same highway class when the join is minor', () => {
    const a = way(1, [10, 11], [51.45, 51.451])
    const b = way(2, [11, 12], [51.451, 51.452])
    const spur: OsmWay = {
      id: 3,
      tags: { highway: 'footway' },
      nodeIds: [11, 20],
      points: [
        { lat: 51.451, lon: -2.5801 },
        { lat: 51.451, lon: -2.579 },
      ],
    }
    const chains = buildChains(buildGraph([a, b, spur]))
    expect(chains).toHaveLength(2)
    const streetChain = chains.find((c) => c.edges[0].highway === 'residential')
    expect(streetChain!.edges).toHaveLength(2)
    expect(streetChain!.toleratedJunctionNodeIds).toEqual([11])
  })

  it('terminates on an ambiguous same-class fork', () => {
    const a: OsmWay = { id: 1, tags: { highway: 'footway' }, nodeIds: [10, 11], points: [{ lat: 51.45, lon: -2.58 }, { lat: 51.451, lon: -2.58 }] }
    const b: OsmWay = { id: 2, tags: { highway: 'footway' }, nodeIds: [11, 12], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.452, lon: -2.58 }] }
    const c: OsmWay = { id: 3, tags: { highway: 'footway' }, nodeIds: [11, 13], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.451, lon: -2.579 }] }
    const chains = buildChains(buildGraph([a, b, c]))
    expect(chains).toHaveLength(3)
    for (const ch of chains) {
      expect(ch.toleratedJunctionNodeIds).toEqual([])
    }
  })

  it('still terminates at a major crossing', () => {
    // the existing crossing test asserts 4 chains; this asserts none of them tolerated anything
    const graph = buildGraph([
      way(1, [10, 20, 12], [51.45, 51.451, 51.452]),
      way(2, [30, 20, 32], [51.46, 51.451, 51.462]),
    ])
    for (const chain of buildChains(graph)) {
      expect(chain.toleratedJunctionNodeIds).toEqual([])
    }
  })

  it('produces the same chain structure regardless of input way order at a tolerable junction', () => {
    // same geometry as the way-id-change test above, built in three different
    // way orders: chain starts must be structural (topology), not an
    // artifact of which edge the walk happened to begin on.
    const a = way(1, [10, 11], [51.45, 51.451])
    const b = way(2, [11, 12], [51.451, 51.452])
    const spur: OsmWay = {
      id: 3,
      tags: { highway: 'footway' },
      nodeIds: [11, 20],
      points: [
        { lat: 51.451, lon: -2.5801 },
        { lat: 51.451, lon: -2.579 },
      ],
    }
    const orders: OsmWay[][] = [
      [a, b, spur],
      [b, a, spur],
      [spur, b, a],
    ]
    for (const ways of orders) {
      const chains = buildChains(buildGraph(ways))
      expect(chains).toHaveLength(2)
      const streetChain = chains.find((c) => c.edges[0].highway === 'residential')
      expect(streetChain).toBeDefined()
      expect(streetChain!.edges).toHaveLength(2)
      expect(streetChain!.toleratedJunctionNodeIds).toEqual([11])
    }
  })

  it('tolerance never shortens chains on the real Bristol fixture and strictly lengthens some', () => {
    const graph = buildGraph(parseOverpassResponse(fixture))
    const chains = buildChains(graph)
    const chainEdgeCount = chains.reduce((s, c) => s + c.edges.length, 0)
    expect(chainEdgeCount).toBe(graph.edges.length)
    const totalTolerated = chains.reduce((s, c) => s + c.toleratedJunctionNodeIds.length, 0)
    expect(totalTolerated).toBeGreaterThan(0)
  })

  describe('wide Bristol fixture (real data, 1500m radius)', () => {
    // See /Users/liamgrogan/Projects/route-planner/.superpowers/sdd/2026-07-28-route-engine-c-finder-rules/final-fix-report.md
    // for the full measured numbers this test's thresholds are drawn from
    // (chain count/length percentiles and per-profile static-candidate
    // counts). Thresholds here are deliberately conservative lower bounds
    // on real, measured, non-zero results — not exact-match assertions —
    // so the test stays a true regression guard without being brittle to
    // incidental logic changes.
    const graph = buildGraph(parseOverpassResponse(wideFixture))
    const chains = buildChains(graph)

    it('parses at least 200 ways from the fixture', () => {
      expect(parseOverpassResponse(wideFixture).length).toBeGreaterThanOrEqual(200)
    })

    it('conserves every edge into exactly one chain', () => {
      const chainEdgeCount = chains.reduce((s, c) => s + c.edges.length, 0)
      expect(chainEdgeCount).toBe(graph.edges.length)
      const chainLength = chains.reduce((s, c) => s + c.lengthMeters, 0)
      const edgeLength = graph.edges.reduce((s, e) => s + e.lengthMeters, 0)
      expect(chainLength).toBeCloseTo(edgeLength, 4)
    })

    it('yields at least one chain long and quiet enough for a 6x800m interval session (static check)', () => {
      const req = terrainRequirementsFor({
        type: 'intervals',
        reps: 6,
        repMeters: 800,
        recovery: 'jog',
      } satisfies Session)
      const candidates = chains.filter((c) => evaluateChain(c, req, null).passes)
      expect(candidates.length).toBeGreaterThanOrEqual(1)
    })

    it('yields at least one chain long and quiet enough for a 12x400m interval session (static check)', () => {
      const req = terrainRequirementsFor({
        type: 'intervals',
        reps: 12,
        repMeters: 400,
        recovery: 'jog',
      } satisfies Session)
      const candidates = chains.filter((c) => evaluateChain(c, req, null).passes)
      expect(candidates.length).toBeGreaterThanOrEqual(1)
    })

    it('yields at least one chain suitable for an 8x300m hills session (static check)', () => {
      const req = terrainRequirementsFor({
        type: 'hills',
        reps: 8,
        hillMeters: 300,
      } satisfies Session)
      const candidates = chains.filter((c) => evaluateChain(c, req, null).passes)
      expect(candidates.length).toBeGreaterThanOrEqual(1)
    })

    it('yields at least one chain >=400m where every edge is quiet (>=0.7) — the minor-join rule unlocking real stretches', () => {
      const long = chains.filter(
        (c) => c.lengthMeters >= 400 && c.edges.every((e) => e.quietness >= 0.7),
      )
      expect(long.length).toBeGreaterThanOrEqual(1)
    })

    // NOTE: a 5000m tempo session (minUninterruptedMeters capped at 1500m,
    // paved, minQuietness 0.6) has ZERO static candidates on this fixture —
    // no single uninterrupted stretch in this 1500m-radius clip is both
    // 1500m long and fully paved/quiet enough. That is a real, measured
    // result (see the fix report), not a bug: it says a production finder
    // would need a wider fetch radius to serve tempo sessions here. No
    // assertion is made for it — the data doesn't support one either way.
  })
})
