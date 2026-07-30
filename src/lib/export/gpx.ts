import type { LatLon } from '@/lib/engine/types'

/**
 * Build a GPX 1.1 document holding a single continuous track (decision 4:
 * export is always one continuous GPX). Pure string builder — no I/O, no
 * browser APIs; the caller wraps the result in a Blob to download it.
 */
export interface GpxTrackOptions {
  /** Track name shown by watches and GPX viewers. */
  name?: string
  /** Free-text track description, e.g. the session's target pace. */
  description?: string
  /**
   * Per-point elevations in meters, index-aligned with `points`. When given,
   * its length must equal `points.length` (a mismatch is an alignment bug and
   * throws). Omit for a track without elevation.
   */
  elevations?: number[]
}

const CREATOR = 'route-planner'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** ~1cm precision; deterministic output for tests. */
function coord(n: number): string {
  return n.toFixed(7)
}

function buildTrackPoint(point: LatLon, elevation: number | undefined): string {
  const open = `<trkpt lat="${coord(point.lat)}" lon="${coord(point.lon)}">`
  const ele = elevation === undefined ? '' : `<ele>${elevation.toFixed(1)}</ele>`
  return `      ${open}${ele}</trkpt>`
}

export function buildGpxTrack(points: LatLon[], options: GpxTrackOptions = {}): string {
  const { name, description, elevations } = options

  if (elevations !== undefined && elevations.length !== points.length) {
    throw new Error(
      `elevations length ${elevations.length} does not match points length ${points.length}`,
    )
  }
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      throw new Error('every point must have finite lat and lon')
    }
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${CREATOR}" xmlns="http://www.topografix.com/GPX/1/1">`,
    '  <trk>',
  ]
  if (name !== undefined) lines.push(`    <name>${escapeXml(name)}</name>`)
  // <desc> follows <name> per the GPX 1.1 trk schema ordering.
  if (description !== undefined) lines.push(`    <desc>${escapeXml(description)}</desc>`)
  lines.push('    <trkseg>')
  for (const [i, point] of points.entries()) {
    lines.push(buildTrackPoint(point, elevations?.[i]))
  }
  lines.push('    </trkseg>', '  </trk>', '</gpx>', '')
  return lines.join('\n')
}
