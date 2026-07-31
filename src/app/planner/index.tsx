'use client'

import { useState } from 'react'
import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import { fetchWays } from '@/lib/engine/overpass'
import { fetchElevations } from '@/lib/engine/elevation'
import { createTerrariumSampler, fetchTerrariumTile } from '@/lib/engine/terrarium'
import { fetchOpenElevations } from '@/lib/engine/open-elevation'
import { withElevationFailover } from '@/lib/engine/elevation-chain'
import { planRoute } from '@/lib/planner/plan-route'
import { SessionForm } from './session-form'
import { StartPoint } from './start-point'
import { Results } from './results'
import type { RunState } from './run-state'

/**
 * Composition shell. Owns the run lifecycle and the resolved start point, and
 * wires the session form (pillar 1) to `planRoute` (pillar 2, routing) and the
 * results screen (pillar 4). Each pillar's UI is its own file; this file only
 * composes them. Slice 2 lifts the orchestration below into tested `.ts`
 * modules (run-state reducer, the elevation-provider chain).
 */

/**
 * Terrain tiles first (keyless, cached, no meaningful quota), then the two
 * hosted APIs as fallbacks — Open-Meteo's per-coordinate quota weighting made
 * it unusable as the sole provider (a burst of searches exhausts the hourly
 * budget and every later search dies on its first elevation batch).
 * Module-scoped so the tile cache survives across searches.
 */
const sampleElevations = withElevationFailover([
  createTerrariumSampler(fetchTerrariumTile),
  fetchOpenElevations,
  fetchElevations,
])

const DEFAULT_RADIUS_METERS = 1200
const MAX_RADIUS_METERS = 8000

export default function Planner() {
  const [start, setStart] = useState<LatLon | null>(null)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [selected, setSelected] = useState(0)

  async function runPlan(session: Session, startPoint: LatLon, radiusMeters: number) {
    setSelected(0)
    setRun({ status: 'loading' })
    try {
      const plan = await planRoute(
        session,
        startPoint,
        { fetchWays, sampleElevations },
        { searchRadiusMeters: radiusMeters },
      )
      setRun({ status: 'done', session, start: startPoint, segments: plan.segments, radiusMeters })
    } catch {
      setRun({
        status: 'error',
        message:
          'Could not search right now — the map or elevation service may be busy. Please try again in a moment.',
      })
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <SessionForm
        loading={run.status === 'loading'}
        hasStart={start !== null}
        onDirty={() => setRun({ status: 'idle' })}
        onSubmit={(session) => {
          if (start) runPlan(session, start, DEFAULT_RADIUS_METERS)
        }}
        startSlot={<StartPoint onStartChange={setStart} />}
      />

      <Results
        run={run}
        selected={selected}
        onSelect={setSelected}
        onWiden={
          run.status === 'done' && run.radiusMeters < MAX_RADIUS_METERS
            ? () =>
                runPlan(
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
