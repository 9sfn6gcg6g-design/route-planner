import { describe, expect, it } from 'vitest'
import {
  buildPostcodeUrl,
  parsePostcodeResponse,
  PostcodeNotFoundError,
} from './geocode'

describe('buildPostcodeUrl', () => {
  it('trims and URL-encodes the postcode', () => {
    expect(buildPostcodeUrl(' BS1 4DJ ')).toBe(
      'https://api.postcodes.io/postcodes/BS1%204DJ',
    )
  })
})

describe('parsePostcodeResponse', () => {
  it('extracts lat/lon from a successful lookup', () => {
    const body = {
      status: 200,
      result: { postcode: 'BS1 4DJ', latitude: 51.4515, longitude: -2.5966 },
    }
    expect(parsePostcodeResponse(body)).toEqual({ lat: 51.4515, lon: -2.5966 })
  })

  it('throws PostcodeNotFoundError when result is null', () => {
    expect(() => parsePostcodeResponse({ status: 404, result: null })).toThrow(
      PostcodeNotFoundError,
    )
  })

  it('throws when coordinates are missing or non-numeric', () => {
    expect(() => parsePostcodeResponse({ result: { latitude: 51.4 } })).toThrow(
      PostcodeNotFoundError,
    )
    expect(() =>
      parsePostcodeResponse({ result: { latitude: '51', longitude: '-2' } }),
    ).toThrow(PostcodeNotFoundError)
  })

  it('throws on a non-object body', () => {
    expect(() => parsePostcodeResponse(null)).toThrow(PostcodeNotFoundError)
    expect(() => parsePostcodeResponse('nope')).toThrow(PostcodeNotFoundError)
  })
})
