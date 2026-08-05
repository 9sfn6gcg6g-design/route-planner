import { describe, expect, it } from 'vitest'
import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import { buildGpxDownload } from './gpx-download'

const points: LatLon[] = [
  { lat: 51.45, lon: -2.6 },
  { lat: 51.46, lon: -2.6 },
]

const tempo: Session = {
  type: 'tempo',
  reps: 1,
  tempoMeters: 5000,
  recovery: 'jog',
  targetPaceSecondsPerKm: 310,
}
const easy: Session = { type: 'easy', distanceMeters: 8000 }
const tempoNoPace: Session = { type: 'tempo', reps: 1, tempoMeters: 5000, recovery: 'jog' }

describe('buildGpxDownload', () => {
  it('names the file from the session and uses the GPX MIME type', () => {
    const dl = buildGpxDownload(tempo, points)
    expect(dl.fileName).toBe('route-tempo-5km.gpx')
    expect(dl.mimeType).toBe('application/gpx+xml')
  })

  it('writes the session summary as the track name', () => {
    expect(buildGpxDownload(tempo, points).contents).toContain('<name>Tempo 5.0 km</name>')
  })

  it('includes the target pace in the description when present (decision 17)', () => {
    expect(buildGpxDownload(tempo, points).contents).toContain('<desc>Target pace 5:10/km</desc>')
  })

  it('omits the description for easy/long sessions', () => {
    expect(buildGpxDownload(easy, points).contents).not.toContain('<desc>')
  })

  it('omits the description when a structured session has no pace', () => {
    expect(buildGpxDownload(tempoNoPace, points).contents).not.toContain('<desc>')
  })

  it('writes a track point per coordinate', () => {
    const dl = buildGpxDownload(easy, points)
    expect(dl.contents.match(/<trkpt /g)).toHaveLength(points.length)
  })
})
