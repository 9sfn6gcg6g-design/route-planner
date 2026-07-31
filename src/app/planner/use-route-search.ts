'use client'

import { useCallback, useReducer, useState } from 'react'
import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import { planRoute, type PlanRouteDeps } from '@/lib/planner'
import { IDLE, runStateReducer, type RunState } from './run-state'

/**
 * Orchestrates a route search: drive the run-state reducer and call
 * `planRoute` behind injected I/O (`deps`). Kept thin and free of JSX so the
 * pure transitions live in the tested `run-state` reducer; this hook just wires
 * them to the network. `deps` must be stable (define it at module scope).
 */

const SEARCH_FAILED_MESSAGE =
  'Could not search right now — the map or elevation service may be busy. Please try again in a moment.'

export interface RouteSearch {
  run: RunState
  /** Index of the highlighted segment in a `done` run. */
  selected: number
  select: (index: number) => void
  search: (session: Session, start: LatLon, radiusMeters: number) => Promise<void>
  /** Back to idle — e.g. when the form is edited and results are stale. */
  reset: () => void
}

export function useRouteSearch(deps: PlanRouteDeps): RouteSearch {
  const [run, dispatch] = useReducer(runStateReducer, IDLE)
  const [selected, setSelected] = useState(0)

  const search = useCallback(
    async (session: Session, start: LatLon, radiusMeters: number) => {
      setSelected(0)
      dispatch({ type: 'search-started' })
      try {
        const plan = await planRoute(session, start, deps, { searchRadiusMeters: radiusMeters })
        dispatch({
          type: 'search-succeeded',
          session,
          start,
          segments: plan.segments,
          routes: plan.routes,
          radiusMeters,
        })
      } catch {
        dispatch({ type: 'search-failed', message: SEARCH_FAILED_MESSAGE })
      }
    },
    [deps],
  )

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])

  return { run, selected, select: setSelected, search, reset }
}
