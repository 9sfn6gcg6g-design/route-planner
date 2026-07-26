import type { Session, TerrainRequirements } from './types'

/**
 * Terrain-requirement profile per session type. Values are the product
 * decisions from the 2026-07-26 grilling session: intervals want flat,
 * smooth, quiet, uninterrupted; hills invert the gradient requirement;
 * easy/long relax everything.
 */
export function terrainRequirementsFor(session: Session): TerrainRequirements {
  switch (session.type) {
    case 'easy':
      return {
        maxAvgGradientPercent: 6,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 8,
        minQuietness: 0.4,
        surface: 'any',
        minUninterruptedMeters: null,
      }
    case 'long':
      return {
        maxAvgGradientPercent: 5,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 5,
        minQuietness: 0.5,
        surface: 'any',
        minUninterruptedMeters: null,
      }
    case 'tempo':
      return {
        maxAvgGradientPercent: 2,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 2,
        minQuietness: 0.6,
        surface: 'paved',
        minUninterruptedMeters: null,
      }
    case 'intervals':
      return {
        maxAvgGradientPercent: 1,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 1,
        minQuietness: 0.7,
        surface: 'paved',
        minUninterruptedMeters: session.repMeters,
      }
    case 'hills':
      return {
        maxAvgGradientPercent: 15,
        minAvgGradientPercent: 4,
        maxJunctionsPerKm: 2,
        minQuietness: 0.5,
        surface: 'any',
        minUninterruptedMeters: session.hillMeters,
      }
  }
}
