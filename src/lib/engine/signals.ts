import type { SurfaceKind } from './types'

/**
 * Road-class proxy for quietness (0–1, 1 = quietest) — the MVP signal per
 * decision #6/#7 in docs/domain.md. Residential is pinned to 0.7, the
 * intervals profile's minQuietness floor, so intervals accept residential
 * streets and everything busier fails.
 */
const QUIETNESS_BY_HIGHWAY: Record<string, number> = {
  footway: 0.9,
  path: 0.9,
  cycleway: 0.9,
  pedestrian: 0.9,
  track: 0.9,
  living_street: 0.85,
  residential: 0.7,
  service: 0.6,
  unclassified: 0.6,
  tertiary: 0.45,
  secondary: 0.3,
  primary: 0.2,
  trunk: 0.1,
}

const DEFAULT_QUIETNESS = 0.5

export function quietnessFor(tags: Record<string, string>): number {
  const highway = tags.highway
  if (highway && highway in QUIETNESS_BY_HIGHWAY) {
    return QUIETNESS_BY_HIGHWAY[highway]
  }
  return DEFAULT_QUIETNESS
}

const PAVED_SURFACES = new Set([
  'asphalt',
  'paved',
  'concrete',
  'paving_stones',
  'sett',
  'concrete:plates',
  'concrete:lanes',
  'chipseal',
])

const UNPAVED_SURFACES = new Set([
  'unpaved',
  'gravel',
  'fine_gravel',
  'compacted',
  'dirt',
  'earth',
  'grass',
  'ground',
  'mud',
  'sand',
  'wood',
  'woodchips',
  'pebblestone',
])

/** Highway classes that are near-always paved (unpaved) when surface is untagged. */
const PAVED_BY_DEFAULT = new Set([
  'residential',
  'living_street',
  'pedestrian',
  'cycleway',
  'service',
  'unclassified',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'footway',
])

const UNPAVED_BY_DEFAULT = new Set(['path', 'track'])

export function surfaceKindFor(tags: Record<string, string>): SurfaceKind {
  const surface = tags.surface
  if (surface) {
    if (PAVED_SURFACES.has(surface)) return 'paved'
    if (UNPAVED_SURFACES.has(surface)) return 'unpaved'
    return 'unknown'
  }
  const highway = tags.highway
  if (highway) {
    if (PAVED_BY_DEFAULT.has(highway)) return 'paved'
    if (UNPAVED_BY_DEFAULT.has(highway)) return 'unpaved'
  }
  return 'unknown'
}
