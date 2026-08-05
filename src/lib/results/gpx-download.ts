import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import { buildGpxTrack } from '@/lib/export/gpx'
import { formatPace, gpxFileName, sessionSummary, sessionTargetPace } from './format'

/** Everything a GPX download needs, ready for the caller to wrap in a Blob. */
export interface GpxDownload {
  fileName: string
  mimeType: string
  contents: string
}

/**
 * Assemble a GPX download from a session and its chosen work stretch: the file
 * name, MIME type, and the GPX document — with the target pace in the
 * description when the session carries one (decision 22). Pure and testable;
 * the UI only wraps `contents` in a Blob and triggers the browser download.
 */
export function buildGpxDownload(session: Session, points: LatLon[]): GpxDownload {
  const pace = sessionTargetPace(session)
  const contents = buildGpxTrack(points, {
    name: sessionSummary(session),
    description: pace !== null ? `Target pace ${formatPace(pace)}` : undefined,
  })
  return { fileName: gpxFileName(session), mimeType: 'application/gpx+xml', contents }
}
