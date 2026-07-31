'use client'

import type { LatLon } from '@/lib/engine/types'
import { fetchWays } from '@/lib/engine/overpass'
import type { PlanRouteDeps } from '@/lib/planner/plan-route'
import { createDefaultElevationSampler } from '@/lib/planner/default-elevation-sampler'
import { useState } from 'react'
import { SessionForm } from './session-form'
import { StartPoint } from './start-point'
import { Results } from './results'
import { useRouteSearch } from './use-route-search'

/**
 * Composition shell. Wires the session form (pillar 1) to `useRouteSearch`
 * (pillar 2, routing) and the results screen (pillar 4). Each pillar's UI is
 * its own file and the orchestration lives in tested modules; this file only
 * holds the resolved start point and composes the pieces.
 */

// Module-scoped so the search deps are stable across renders and the terrarium
// tile cache (inside the sampler) survives across searches.
const DEPS: PlanRouteDeps = {
  fetchWays,
  sampleElevations: createDefaultElevationSampler(),
}

const DEFAULT_RADIUS_METERS = 1200
const MAX_RADIUS_METERS = 8000

export default function Planner() {
  const [start, setStart] = useState<LatLon | null>(null)
  const { run, selected, select, search, reset } = useRouteSearch(DEPS)

  return (
    <div className="flex flex-col gap-10">
      <SessionForm
        loading={run.status === 'loading'}
        hasStart={start !== null}
        onDirty={reset}
        onSubmit={(session) => {
          if (start) search(session, start, DEFAULT_RADIUS_METERS)
        }}
        startSlot={<StartPoint onStartChange={setStart} />}
      />

      <Results
        run={run}
        selected={selected}
        onSelect={select}
        onWiden={
          run.status === 'done' && run.radiusMeters < MAX_RADIUS_METERS
            ? () =>
                search(
                  run.session,
                  run.start,
                  Math.min(run.radiusMeters * 2, MAX_RADIUS_METERS),
                )
            : undefined
        }
      />
    </div>
  )
}
