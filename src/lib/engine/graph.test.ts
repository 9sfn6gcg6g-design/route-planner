import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/overpass-bristol.json'
import { buildGraph } from './graph'
import { parseOverpassResponse } from './overpass'
import { pathLengthMeters } from './geo'
import type { OsmWay } from './types'

function way(id: number, nodeIds: number[], lats: number[], highway = 'residential'): OsmWay {
  return {
    id,
    tags: { highway },
    nodeIds,
    points: lats.map((lat, i) => ({ lat, lon: -2.58 - i * 0.0001 })),
  }
}

describe('buildGraph', () => {
  it('keeps an isolated way as a single edge', () => {
    const graph = buildGraph([way(1, [10, 11, 12], [51.45, 51.451, 51.452])])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].fromNodeId).toBe(10)
    expect(graph.edges[0].toNodeId).toBe(12)
    expect(graph.edges[0].points).toHaveLength(3)
    expect(graph.junctionNodeIds.size).toBe(0)
  })

  it('splits two crossing ways at their shared node into four edges', () => {
    // way 1: 10 - 20 - 12 ; way 2: 30 - 20 - 32 (junction at 20)
    const a = way(1, [10, 20, 12], [51.45, 51.451, 51.452])
    const b = way(2, [30, 20, 32], [51.46, 51.451, 51.462])
    const graph = buildGraph([a, b])
    expect(graph.junctionNodeIds.has(20)).toBe(true)
    expect(graph.edges).toHaveLength(4)
    const boundaries = graph.edges.map((e) => [e.fromNodeId, e.toNodeId])
    expect(boundaries).toContainEqual([10, 20])
    expect(boundaries).toContainEqual([20, 12])
    expect(boundaries).toContainEqual([30, 20])
    expect(boundaries).toContainEqual([20, 32])
  })

  it('gives a true crossing node edge-degree 4 and a leaf node edge-degree 1', () => {
    // way 1: 10 - 20 - 12 ; way 2: 30 - 20 - 32 (junction at 20)
    const a = way(1, [10, 20, 12], [51.45, 51.451, 51.452])
    const b = way(2, [30, 20, 32], [51.46, 51.451, 51.462])
    const graph = buildGraph([a, b])
    expect(graph.nodeDegree.get(20)).toBe(4)
    expect(graph.nodeDegree.get(10)).toBe(1)
  })

  it('does not split when ways merely touch end-to-end', () => {
    // way 1 ends at 20; way 2 starts at 20 — shared endpoint is a junction node,
    // but each way still yields one edge (no interior split point).
    const a = way(1, [10, 11, 20], [51.45, 51.451, 51.452])
    const b = way(2, [20, 21, 22], [51.452, 51.453, 51.454])
    const graph = buildGraph([a, b])
    expect(graph.edges).toHaveLength(2)
    expect(graph.junctionNodeIds.has(20)).toBe(true)
  })

  it('marks an end-to-end touch as a degree-2 splice even though it is a junction node', () => {
    // way 1 ends at 20; way 2 starts at 20 — a junction node by the
    // "used by more than one way" rule, but structurally just a splice:
    // exactly one edge arrives and one edge leaves, so its edge-degree is 2,
    // not the >=3 that a real crossing would have.
    const a = way(1, [10, 11, 20], [51.45, 51.451, 51.452])
    const b = way(2, [20, 21, 22], [51.452, 51.453, 51.454])
    const graph = buildGraph([a, b])
    expect(graph.junctionNodeIds.has(20)).toBe(true)
    expect(graph.nodeDegree.get(20)).toBe(2)
  })

  it('skips ways without a highway tag, contributing no edges or node degree', () => {
    const untagged: OsmWay = {
      id: 99,
      tags: {},
      nodeIds: [10, 11],
      points: [
        { lat: 51.45, lon: -2.58 },
        { lat: 51.451, lon: -2.5801 },
      ],
    }
    const graph = buildGraph([untagged])
    expect(graph.edges).toHaveLength(0)
    expect(graph.nodeDegree.size).toBe(0)
    expect(graph.junctionNodeIds.size).toBe(0)
  })

  it('computes edge length from geometry and stamps signals from tags', () => {
    const w = way(1, [10, 11], [51.45, 51.46], 'footway')
    const graph = buildGraph([w])
    expect(graph.edges[0].lengthMeters).toBeCloseTo(pathLengthMeters(w.points), 6)
    expect(graph.edges[0].highway).toBe('footway')
    expect(graph.edges[0].quietness).toBe(0.9)
    expect(graph.edges[0].surface).toBe('paved')
    expect(graph.edges[0].wayId).toBe(1)
  })

  it('builds a coherent graph from the real Bristol fixture', () => {
    const ways = parseOverpassResponse(fixture)
    const graph = buildGraph(ways)
    expect(graph.edges.length).toBeGreaterThanOrEqual(ways.length)
    for (const edge of graph.edges) {
      expect(edge.lengthMeters).toBeGreaterThan(0)
      expect(edge.points.length).toBeGreaterThanOrEqual(2)
      expect(edge.quietness).toBeGreaterThan(0)
      expect(edge.quietness).toBeLessThanOrEqual(1)
    }
    expect(graph.junctionNodeIds.size).toBeGreaterThan(0)
    // Real OSM data over-splits conservatively: some junction nodes are
    // true crossings, but plenty are degree-2 splices (a way broken at a
    // name/speed-limit change with no actual fork). Both must be present.
    expect(graph.nodeDegree.size).toBeGreaterThan(0)
    const spliceNodes = [...graph.junctionNodeIds].filter(
      (id) => graph.nodeDegree.get(id) === 2,
    )
    expect(spliceNodes.length).toBeGreaterThan(0)
  })
})
