import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import type { WorkSegment } from '@/lib/engine/finder'
import type { AssembledRoute } from '@/lib/engine/assemble'

/**
 * The route-search lifecycle the shell drives and the results screen renders,
 * as a pure reducer so the transitions are testable without React. The
 * `use-route-search` hook wraps this with `useReducer` and the network call.
 */
export type RunState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'done'
      session: Session
      start: LatLon
      segments: WorkSegment[]
      /** Door-to-door loop per segment (decision 21); null = show the bare stretch. */
      routes: Array<AssembledRoute | null>
      radiusMeters: number
    }

export type RunAction =
  | { type: 'search-started' }
  | {
      type: 'search-succeeded'
      session: Session
      start: LatLon
      segments: WorkSegment[]
      routes: Array<AssembledRoute | null>
      radiusMeters: number
    }
  | { type: 'search-failed'; message: string }
  | { type: 'reset' }

export const IDLE: RunState = { status: 'idle' }

/** Transitions are fully determined by the action; state is unused by design. */
export function runStateReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'search-started':
      return { status: 'loading' }
    case 'search-succeeded':
      return {
        status: 'done',
        session: action.session,
        start: action.start,
        segments: action.segments,
        routes: action.routes,
        radiusMeters: action.radiusMeters,
      }
    case 'search-failed':
      return { status: 'error', message: action.message }
    case 'reset':
      return IDLE
  }
}
