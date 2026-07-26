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

  it('does not split when ways merely touch end-to-end', () => {
    // way 1 ends at 20; way 2 starts at 20 — shared endpoint is a junction node,
    // but each way still yields one edge (no interior split point).
    const a = way(1, [10, 11, 20], [51.45, 51.451, 51.452])
    const b = way(2, [20, 21, 22], [51.452, 51.453, 51.454])
    const graph = buildGraph([a, b])
    expect(graph.edges).toHaveLength(2)
    expect(graph.junctionNodeIds.has(20)).toBe(true)
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
  })
})
