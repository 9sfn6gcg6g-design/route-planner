import { describe, expect, it } from 'vitest'
import { buildDirectionsBody, buildRoundTripBody, parseOrsResponse } from './connectors'

const orsFixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { summary: { distance: 1176.3, duration: 846.9 } },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-2.5879, 51.4545],
          [-2.59, 51.4562],
          [-2.595, 51.46],
        ],
      },
    },
  ],
}

describe('buildDirectionsBody', () => {
  it('emits lon-first coordinate pairs', () => {
    const body = buildDirectionsBody({ lat: 51.4545, lon: -2.5879 }, { lat: 51.46, lon: -2.595 })
    expect(body.coordinates).toEqual([
      [-2.5879, 51.4545],
      [-2.595, 51.46],
    ])
  })
})

describe('buildRoundTripBody', () => {
  it('requests a round trip of the given length from one coordinate', () => {
    const body = buildRoundTripBody({ lat: 51.4545, lon: -2.5879 }, 8000, 7)
    expect(body.coordinates).toEqual([[-2.5879, 51.4545]])
    expect(body.options.round_trip).toEqual({ length: 8000, points: 3, seed: 7 })
  })

  it('defaults the seed', () => {
    expect(buildRoundTripBody({ lat: 51, lon: -2 }, 5000).options.round_trip.seed).toBe(1)
  })
})

describe('parseOrsResponse', () => {
  it('parses points (lat/lon swapped back) and distance', () => {
    const route = parseOrsResponse(orsFixture)
    expect(route.lengthMeters).toBeCloseTo(1176.3, 3)
    expect(route.points).toHaveLength(3)
    expect(route.points[0]).toEqual({ lat: 51.4545, lon: -2.5879 })
    expect(route.points[2]).toEqual({ lat: 51.46, lon: -2.595 })
  })

  it('throws descriptively on null, missing features, and empty features', () => {
    expect(() => parseOrsResponse(null)).toThrow(/features/)
    expect(() => parseOrsResponse({ error: 'x' })).toThrow(/features/)
    expect(() => parseOrsResponse({ features: [] })).toThrow(/features/)
  })
})
