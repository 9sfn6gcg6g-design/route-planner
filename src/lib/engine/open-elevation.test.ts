import { describe, expect, it } from 'vitest'
import { buildOpenElevationBody, parseOpenElevationResponse } from './open-elevation'

describe('buildOpenElevationBody', () => {
  it('maps LatLon points to the locations shape the API expects', () => {
    expect(
      buildOpenElevationBody([
        { lat: 51.4545, lon: -2.5879 },
        { lat: 51.46, lon: -2.6 },
      ]),
    ).toEqual({
      locations: [
        { latitude: 51.4545, longitude: -2.5879 },
        { latitude: 51.46, longitude: -2.6 },
      ],
    })
  })
})

describe('parseOpenElevationResponse', () => {
  it('extracts elevations in order', () => {
    const body = {
      results: [
        { latitude: 51.4545, longitude: -2.5879, elevation: 12 },
        { latitude: 51.46, longitude: -2.6, elevation: 33.5 },
      ],
    }
    expect(parseOpenElevationResponse(body, 2)).toEqual([12, 33.5])
  })

  it('rejects a response with no results array', () => {
    expect(() => parseOpenElevationResponse(null, 1)).toThrow(/no results array/)
    expect(() => parseOpenElevationResponse({ error: 'x' }, 1)).toThrow(/no results array/)
  })

  it('rejects results whose elevation is missing or non-numeric', () => {
    expect(() =>
      parseOpenElevationResponse({ results: [{ latitude: 1, longitude: 2 }] }, 1),
    ).toThrow(/no results array|non-numeric/)
    expect(() =>
      parseOpenElevationResponse(
        { results: [{ latitude: 1, longitude: 2, elevation: 'high' }] },
        1,
      ),
    ).toThrow(/non-numeric/)
  })

  it('rejects a count mismatch', () => {
    const body = { results: [{ latitude: 1, longitude: 2, elevation: 5 }] }
    expect(() => parseOpenElevationResponse(body, 2)).toThrow(/returned 1 elevations, expected 2/)
  })
})
