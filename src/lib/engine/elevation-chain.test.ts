import { describe, expect, it } from 'vitest'
import { withElevationFailover } from './elevation-chain'
import type { LatLon } from './types'

const POINTS: LatLon[] = [{ lat: 51.45, lon: -2.59 }]

describe('withElevationFailover', () => {
  it('returns the first provider result when it succeeds', async () => {
    const sampler = withElevationFailover([
      async () => [1],
      async () => {
        throw new Error('should not be called')
      },
    ])
    expect(await sampler(POINTS)).toEqual([1])
  })

  it('falls through failing providers in order', async () => {
    const calls: string[] = []
    const sampler = withElevationFailover([
      async () => {
        calls.push('a')
        throw new Error('a down')
      },
      async () => {
        calls.push('b')
        throw new Error('b down')
      },
      async () => {
        calls.push('c')
        return [7]
      },
    ])
    expect(await sampler(POINTS)).toEqual([7])
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('surfaces the last error when every provider fails', async () => {
    const sampler = withElevationFailover([
      async () => {
        throw new Error('a down')
      },
      async () => {
        throw new Error('b down')
      },
    ])
    await expect(sampler(POINTS)).rejects.toThrow(/b down/)
  })

  it('rejects an empty provider list at construction', () => {
    expect(() => withElevationFailover([])).toThrow(/at least one provider/)
  })
})
