import { describe, expect, it } from 'vitest'
import {
  avgAbsGradientPercent,
  buildElevationUrl,
  chunk,
  parseElevationResponse,
} from './elevation'

describe('chunk', () => {
  it('splits into batches of the given size with a smaller tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns one batch when under the size', () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]])
  })

  it('returns no batches for an empty list', () => {
    expect(chunk([], 100)).toEqual([])
  })
})

describe('buildElevationUrl', () => {
  it('joins coordinates into comma lists', () => {
    const url = buildElevationUrl([
      { lat: 51.4545, lon: -2.5879 },
      { lat: 51.455, lon: -2.588 },
    ])
    expect(url).toContain('api.open-meteo.com/v1/elevation')
    expect(url).toContain('latitude=51.4545,51.455')
    expect(url).toContain('longitude=-2.5879,-2.588')
  })
})

describe('parseElevationResponse', () => {
  it('returns the elevation array when the count matches', () => {
    expect(parseElevationResponse({ elevation: [11, 18, 26] }, 3)).toEqual([11, 18, 26])
  })

  it('throws when the count does not match the points sent', () => {
    expect(() => parseElevationResponse({ elevation: [11] }, 3)).toThrow(/expected 3/)
  })

  it('throws when the body has no elevation array', () => {
    expect(() => parseElevationResponse({ error: true }, 2)).toThrow(/elevation/)
  })
})

describe('avgAbsGradientPercent', () => {
  it('computes mean absolute gradient over the path', () => {
    // up 5m over 100m, down 5m over 100m -> (5+5)/200 = 5%
    expect(avgAbsGradientPercent([0, 5, 0], [0, 100, 200])).toBeCloseTo(5, 6)
  })

  it('is zero for flat ground', () => {
    expect(avgAbsGradientPercent([10, 10, 10], [0, 50, 120])).toBe(0)
  })

  it('is zero for degenerate paths (fewer than two points or zero length)', () => {
    expect(avgAbsGradientPercent([5], [0])).toBe(0)
    expect(avgAbsGradientPercent([5, 6], [0, 0])).toBe(0)
  })

  it('throws when array lengths differ', () => {
    expect(() => avgAbsGradientPercent([0, 5], [0])).toThrow(/length/)
  })
})
