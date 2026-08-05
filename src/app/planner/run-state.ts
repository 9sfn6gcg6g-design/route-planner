import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import type { WorkSegment } from '@/lib/engine/finder'

/**
 * The route-search lifecycle the shell drives and the results screen renders.
 * Slice 2 adds a pure reducer beside this type; for now it is the shared shape
 * so the shell and `results.tsx` agree without importing each other.
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
