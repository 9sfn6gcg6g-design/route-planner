import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/overpass-bristol.json'
import { buildOverpassQuery, parseOverpassResponse } from './overpass'

describe('buildOverpassQuery', () => {
  it('targets the given center and radius with geometry output', () => {
    const q = buildOverpassQuery({ lat: 51.4545, lon: -2.5879 }, 1200)
    expect(q).toContain('around:1200,51.4545,-2.5879')
    expect(q).toContain('out geom')
    expect(q).toContain('[out:json]')
  })

  it('excludes steps from the highway filter', () => {
    const q = buildOverpassQuery({ lat: 51.4545, lon: -2.5879 }, 1200)
    expect(q).not.toContain('steps')
    expect(q).toContain('residential')
    expect(q).toContain('footway')
  })
})

describe('parseOverpassResponse', () => {
  it('parses the committed Bristol fixture into ways with geometry', () => {
    const ways = parseOverpassResponse(fixture)
    expect(ways.length).toBeGreaterThanOrEqual(20)
    for (const way of ways) {
      expect(way.id).toBeGreaterThan(0)
      expect(way.nodeIds.length).toBeGreaterThanOrEqual(2)
      expect(way.points.length).toBe(way.nodeIds.length)
      expect(typeof way.tags.highway).toBe('string')
      for (const p of way.points) {
        expect(p.lat).toBeGreaterThan(51.4)
        expect(p.lat).toBeLessThan(51.5)
        expect(p.lon).toBeGreaterThan(-2.7)
        expect(p.lon).toBeLessThan(-2.5)
      }
    }
  })

  it('ignores non-way elements and ways without geometry', () => {
    const ways = parseOverpassResponse({
      elements: [
        { type: 'node', id: 1, lat: 51, lon: -2 },
        { type: 'way', id: 2, tags: { highway: 'residential' } },
        {
          type: 'way',
          id: 3,
          tags: { highway: 'residential' },
          nodes: [10, 11],
          geometry: [
            { lat: 51.45, lon: -2.58 },
            { lat: 51.46, lon: -2.58 },
          ],
        },
      ],
    })
    expect(ways).toHaveLength(1)
    expect(ways[0].id).toBe(3)
  })

  it('throws on a body with no elements array', () => {
    expect(() => parseOverpassResponse({ remark: 'timeout' })).toThrow(/elements/)
  })
})
