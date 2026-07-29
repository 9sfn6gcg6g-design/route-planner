import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/overpass-bristol.json'
import {
  buildOverpassQuery,
  fetchWays,
  OVERPASS_ENDPOINTS,
  OverpassUnavailableError,
  parseOverpassResponse,
  type FetchImpl,
} from './overpass'

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

  it('throws a descriptive error instead of a raw TypeError on a null body', () => {
    expect(() => parseOverpassResponse(null)).toThrow(/elements/)
  })
})

describe('fetchWays (endpoint fallback + retry)', () => {
  const center = { lat: 51.4545, lon: -2.5879 }
  const wayBody = JSON.stringify({
    elements: [
      {
        type: 'way',
        id: 42,
        tags: { highway: 'residential' },
        nodes: [1, 2],
        geometry: [
          { lat: 51.45, lon: -2.58 },
          { lat: 51.46, lon: -2.58 },
        ],
      },
    ],
  })
  const ok = () => new Response(wayBody, { status: 200 })
  const status = (code: number) => new Response('nope', { status: code })

  /** A fetch that returns scripted responses per URL, in order, and records calls. */
  function scriptedFetch(script: Record<string, Array<Response | 'throw'>>) {
    const calls: string[] = []
    const impl: FetchImpl = async (url) => {
      calls.push(url)
      const next = script[url]?.shift()
      if (!next) throw new Error(`no scripted response for ${url}`)
      if (next === 'throw') throw new Error('network down')
      return next
    }
    return { impl, calls }
  }

  const A = 'https://a.test/api'
  const B = 'https://b.test/api'

  it('ships at least one fallback mirror by default', () => {
    expect(OVERPASS_ENDPOINTS.length).toBeGreaterThan(1)
  })

  it('falls over to the next endpoint when the first is busy', async () => {
    const { impl, calls } = scriptedFetch({ [A]: [status(504)], [B]: [ok()] })
    const ways = await fetchWays(center, 1000, {
      endpoints: [A, B],
      retriesPerEndpoint: 0,
      fetchImpl: impl,
    })
    expect(ways).toHaveLength(1)
    expect(calls).toEqual([A, B])
  })

  it('retries a transient failure on the same endpoint before moving on', async () => {
    const { impl, calls } = scriptedFetch({ [A]: [status(504), ok()], [B]: [ok()] })
    const ways = await fetchWays(center, 1000, {
      endpoints: [A, B],
      retriesPerEndpoint: 1,
      backoffMs: 0,
      fetchImpl: impl,
    })
    expect(ways).toHaveLength(1)
    expect(calls).toEqual([A, A]) // recovered on A's retry; B never tried
  })

  it('recovers from a network error by trying the next endpoint', async () => {
    const { impl, calls } = scriptedFetch({ [A]: ['throw'], [B]: [ok()] })
    const ways = await fetchWays(center, 1000, {
      endpoints: [A, B],
      retriesPerEndpoint: 0,
      fetchImpl: impl,
    })
    expect(ways).toHaveLength(1)
    expect(calls).toEqual([A, B])
  })

  it('does not retry a non-transient status; skips to the next mirror', async () => {
    const { impl, calls } = scriptedFetch({ [A]: [status(400)], [B]: [ok()] })
    const ways = await fetchWays(center, 1000, {
      endpoints: [A, B],
      retriesPerEndpoint: 3,
      backoffMs: 0,
      fetchImpl: impl,
    })
    expect(ways).toHaveLength(1)
    expect(calls).toEqual([A, B]) // A tried once despite retries allowed
  })

  it('throws OverpassUnavailableError with the statuses when every instance fails', async () => {
    const { impl } = scriptedFetch({ [A]: [status(504)], [B]: [status(429)] })
    await expect(
      fetchWays(center, 1000, { endpoints: [A, B], retriesPerEndpoint: 0, fetchImpl: impl }),
    ).rejects.toBeInstanceOf(OverpassUnavailableError)
  })
})
