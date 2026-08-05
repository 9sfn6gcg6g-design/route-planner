import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import type { WorkSegment } from '@/lib/engine/finder'

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
      radiusMeters: number
    }

export type RunAction =
  | { type: 'search-started' }
  | {
      type: 'search-succeeded'
      session: Session
      start: LatLon
      segments: WorkSegment[]
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
        radiusMeters: action.radiusMeters,
      }
    case 'search-failed':
      return { status: 'error', message: action.message }
    case 'reset':
      return IDLE
  }
}
