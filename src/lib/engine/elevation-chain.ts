import type { LatLon } from './types'
import type { ElevationSampler } from './finder'

/**
 * Chain elevation providers the way fetchWays chains Overpass mirrors: try
 * each in order, moving on when one throws, so a rate-limited or flaky
 * provider degrades the search instead of killing it.
 */
export function withElevationFailover(providers: ElevationSampler[]): ElevationSampler {
  if (providers.length === 0) {
    throw new Error('withElevationFailover needs at least one provider')
  }
  return async (points: LatLon[]): Promise<number[]> => {
    let lastError: unknown
    for (const provider of providers) {
      try {
        return await provider(points)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
}
