import { describe, expect, it } from 'vitest'
import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import type { WorkSegment } from '@/lib/engine/finder'
import { IDLE, runStateReducer, type RunState } from './run-state'

const session: Session = { type: 'easy', distanceMeters: 8000 }
const start: LatLon = { lat: 51.45, lon: -2.6 }
const segment: WorkSegment = {
  points: [start, { lat: 51.46, lon: -2.6 }],
  lengthMeters: 1200,
  distanceFromStartMeters: 300,
  isCycle: false,
  minQuietness: 0.8,
  avgAbsGradientPercent: 1.2,
  crossings: 0,
  quality: 0.87,
}

describe('runStateReducer', () => {
  it('starts a search from any state', () => {
    expect(runStateReducer(IDLE, { type: 'search-started' })).toEqual({ status: 'loading' })
  })

  it('records a successful search with its segments and radius', () => {
    const next = runStateReducer(
      { status: 'loading' },
      { type: 'search-succeeded', session, start, segments: [segment], radiusMeters: 1200 },
    )
    expect(next).toEqual({
      status: 'done',
      session,
      start,
      segments: [segment],
      radiusMeters: 1200,
    })
  })

  it('records a failed search with its message', () => {
    expect(runStateReducer({ status: 'loading' }, { type: 'search-failed', message: 'busy' })).toEqual(
      { status: 'error', message: 'busy' },
    )
  })

  it('resets back to idle (e.g. when the form is edited)', () => {
    const done: RunState = {
      status: 'done',
      session,
      start,
      segments: [segment],
      radiusMeters: 1200,
    }
    expect(runStateReducer(done, { type: 'reset' })).toEqual(IDLE)
  })

  it('is state-independent — the action fully determines the next state', () => {
    const done: RunState = {
      status: 'done',
      session,
      start,
      segments: [segment],
      radiusMeters: 1200,
    }
    expect(runStateReducer(done, { type: 'search-started' })).toEqual(
      runStateReducer(IDLE, { type: 'search-started' }),
    )
  })
})
