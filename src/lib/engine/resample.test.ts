import { describe, expect, it } from 'vitest'
import { haversineMeters } from './geo'
import { resamplePoints } from './resample'

describe('resamplePoints', () => {
  it('re-spaces a long straight segment to the given interval', () => {
    // ~1000m due north in a single segment
    const line = [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.459, lon: -2.58 },
    ]
    const resampled = resamplePoints(line, 100)
    expect(resampled.length).toBeGreaterThanOrEqual(11)
    expect(resampled[0]).toEqual(line[0])
    expect(resampled[resampled.length - 1]).toEqual(line[1])
    for (let i = 1; i < resampled.length - 1; i++) {
      expect(haversineMeters(resampled[i - 1], resampled[i])).toBeCloseTo(100, 0)
    }
  })

  it('keeps endpoints when the interval exceeds the path length', () => {
    const short = [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.4501, lon: -2.58 },
    ]
    expect(resamplePoints(short, 500)).toEqual(short)
  })

  it('passes through degenerate inputs', () => {
    const p = { lat: 51.45, lon: -2.58 }
    expect(resamplePoints([p], 50)).toEqual([p])
    expect(resamplePoints([], 50)).toEqual([])
  })

  it('throws on a non-positive interval', () => {
    expect(() => resamplePoints([{ lat: 51, lon: -2 }], 0)).toThrow(/interval/)
    expect(() => resamplePoints([{ lat: 51, lon: -2 }], -5)).toThrow(/interval/)
  })
})
