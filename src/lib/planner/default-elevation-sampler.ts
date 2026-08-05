import type { ElevationSampler } from '@/lib/engine/finder'
import { fetchElevations } from '@/lib/engine/elevation'
import { withElevationFailover } from '@/lib/engine/elevation-chain'
import { fetchOpenElevations } from '@/lib/engine/open-elevation'
import { createTerrariumSampler, fetchTerrariumTile } from '@/lib/engine/terrarium'

/**
 * The three elevation providers, in the order the search tries them. This is
 * composition of engine functions, so it lives in `planner` (the one layer
 * allowed to import engine *functions* — AGENTS.md Layering), out of the React
 * component that used to wire it inline.
 */
export interface ElevationProviders {
  terrarium: ElevationSampler
  openElevation: ElevationSampler
  openMeteo: ElevationSampler
}

function realProviders(): ElevationProviders {
  return {
    terrarium: createTerrariumSampler(fetchTerrariumTile),
    openElevation: fetchOpenElevations,
    openMeteo: fetchElevations,
  }
}

/**
 * Build the default elevation sampler: terrarium tiles first (keyless, cached,
 * effectively unmetered — decision 6's amendment), failing over to
 * Open-Elevation then Open-Meteo. The order is the policy this module owns;
 * tests inject fakes for `providers` to pin it without network. Call once and
 * reuse so the terrarium tile cache survives across searches.
 */
export function createDefaultElevationSampler(
  providers: ElevationProviders = realProviders(),
): ElevationSampler {
  return withElevationFailover([providers.terrarium, providers.openElevation, providers.openMeteo])
}
