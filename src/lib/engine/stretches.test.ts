import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/overpass-bristol.json'
import { buildChains } from './chains'
import { buildGraph } from './graph'
import { parseOverpassResponse } from './overpass'
import { assembleStretches } from './stretches'
import type { OsmWay } from './types'

/** A way from explicit [lat, lon] points, so bearings are fully controlled. */
function way(id: number, nodeIds: number[], pts: Array<[number, number]>, highway = 'residential'): OsmWay {
  return { id, tags: { highway }, nodeIds, points: pts.map(([lat, lon]) => ({ lat, lon })) }
}

// A junction J (node 20) approached from the west along A→J (heading east).
// Branches leave J to the north (left turn), south (right turn) and east
// (straight across). Each way is its own corridor because J has degree 4.
const J: [number, number] = [51.45, -2.58]
const A: [number, number] = [51.45, -2.588] // west of J
const N: [number, number] = [51.458, -2.58] // north of J
const S: [number, number] = [51.442, -2.58] // south of J
const E: [number, number] = [51.45, -2.572] // east of J

function crossroads(branches: { north?: boolean; south?: boolean; east?: boolean }): OsmWay[] {
  const ways: OsmWay[] = [way(1, [10, 20], [A, J])]
  if (branches.north) ways.push(way(2, [20, 30], [J, N]))
  if (branches.south) ways.push(way(3, [20, 40], [J, S]))
  if (branches.east) ways.push(way(4, [20, 50], [J, E]))
  return ways
}

/** The stretch that begins at node 10 (the A→J seed extended). */
function seededFromA(graph: ReturnType<typeof buildGraph>) {
  return assembleStretches(graph, { targetMeters: 900 }).find((s) => s.chain.startNodeId === 10)
}

describe('assembleStretches — turn preference', () => {
  it('prefers a left turn over right and straight, with no crossing', () => {
    const graph = buildGraph(crossroads({ north: true, south: true, east: true }))
    const stretch = seededFromA(graph)
    expect(stretch).toBeDefined()
    expect(stretch!.chain.endNodeId).toBe(30) // turned north (left)
    expect(stretch!.crossings).toBe(0)
  })

  it('falls back to a right turn when no left exists, still no crossing', () => {
    const graph = buildGraph(crossroads({ south: true, east: true }))
    const stretch = seededFromA(graph)
    expect(stretch!.chain.endNodeId).toBe(40) // turned south (right)
    expect(stretch!.crossings).toBe(0)
  })

  it('crosses straight through only when no turn is available, and tallies it', () => {
    // A→J plus a straight east branch and a branch doubling back to the west,
    // so J stays a real junction (degree 3) but the only forward option is
    // straight across.
    const W: [number, number] = [51.4503, -2.588]
    const graph = buildGraph([...crossroads({ east: true }), way(5, [20, 60], [J, W])])
    const stretch = seededFromA(graph)
    expect(stretch!.chain.endNodeId).toBe(50) // went straight east
    expect(stretch!.crossings).toBe(1)
  })

  it('prefers the gentler of two same-side turns and records the angle (decision 18)', () => {
    // Both branches turn right off the eastward approach: G by ~60°, Sharp by
    // ~110°. The old left>right>straight rule could not tell them apart; the
    // gentlest-first rule takes G.
    const G: [number, number] = [51.448444, -2.578557] // ~60° right
    const Sharp: [number, number] = [51.44831, -2.580987] // ~110° right
    const graph = buildGraph([way(1, [10, 20], [A, J]), way(2, [20, 30], [J, G]), way(3, [20, 40], [J, Sharp])])
    const stretch = assembleStretches(graph, { targetMeters: 700 }).find((s) => s.chain.startNodeId === 10)
    expect(stretch).toBeDefined()
    expect(stretch!.chain.endNodeId).toBe(30) // took the gentler turn
    expect(stretch!.crossings).toBe(0)
    expect(stretch!.turnAngles).toHaveLength(1)
    expect(Math.abs(stretch!.turnAngles[0])).toBeLessThan(90)
  })
})

describe('assembleStretches — flow continuation (decision 17)', () => {
  // Left branch is an ~11m sliver; straight-on is a long path of equal
  // quietness. Decision 15's turn order walks onto the sliver; decision 17's
  // flow follows the sustained path (a fragmented waterfront, in the wild).
  const NearN: [number, number] = [51.4501, -2.58]
  const ways = [way(1, [10, 20], [A, J]), way(2, [20, 30], [J, NearN]), way(4, [20, 50], [J, E])]

  it('turn order (default) walks off onto the sliver left turn', () => {
    const graph = buildGraph(ways)
    const stretch = assembleStretches(graph, { targetMeters: 900 }).find(
      (s) => s.chain.startNodeId === 10,
    )
    expect(stretch!.chain.endNodeId).toBe(30) // took the 11m left sliver
  })

  it('flow follows the sustained path instead, still tallying the crossing', () => {
    const graph = buildGraph(ways)
    const stretch = assembleStretches(graph, {
      targetMeters: 900,
      continuation: 'flow',
    }).find((s) => s.chain.startNodeId === 10)
    expect(stretch!.chain.endNodeId).toBe(50) // straight along the long path
    expect(stretch!.crossings).toBe(1)
  })
})

describe('assembleStretches — invariants', () => {
  const graph = buildGraph(parseOverpassResponse(fixture))

  it('returns one crossing-free stretch per corridor when not extending', () => {
    const corridors = buildChains(graph)
    const stretches = assembleStretches(graph) // targetMeters defaults to 0
    expect(stretches).toHaveLength(corridors.length)
    expect(stretches.every((s) => s.crossings === 0)).toBe(true)
    expect(stretches.every((s) => s.turnAngles.length === 0)).toBe(true)
    const corridorLength = corridors.reduce((sum, c) => sum + c.lengthMeters, 0)
    const stretchLength = stretches.reduce((sum, s) => sum + s.chain.lengthMeters, 0)
    expect(stretchLength).toBeCloseTo(corridorLength, 6)
  })

  it('is deterministic — identical crossings and lengths across runs', () => {
    const a = assembleStretches(graph, { targetMeters: 1500 })
    const b = assembleStretches(graph, { targetMeters: 1500 })
    expect(a.map((s) => s.crossings)).toEqual(b.map((s) => s.crossings))
    expect(a.map((s) => Math.round(s.chain.lengthMeters))).toEqual(
      b.map((s) => Math.round(s.chain.lengthMeters)),
    )
  })

  it('extends corridors to reach a length floor where the network allows', () => {
    const corridors = buildChains(graph)
    const longestCorridor = Math.max(...corridors.map((c) => c.lengthMeters))
    const extended = assembleStretches(graph, { targetMeters: 1500 })
    const longestStretch = Math.max(...extended.map((s) => s.chain.lengthMeters))
    expect(longestStretch).toBeGreaterThan(longestCorridor)
  })
})
