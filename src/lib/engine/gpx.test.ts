import { describe, expect, it } from 'vitest'
import type { AssembledRoute } from './assemble'
import { toGpx } from './gpx'

const route: AssembledRoute = {
  points: [
    { lat: 51.44, lon: -2.58 },
    { lat: 51.45, lon: -2.58 },
    { lat: 51.459, lon: -2.58 },
    { lat: 51.44, lon: -2.58 },
  ],
  totalMeters: 3200,
  phases: [
    { kind: 'warmup', startIndex: 0, endIndex: 1, meters: 500 },
    { kind: 'work', startIndex: 2, endIndex: 2, meters: 2100 },
    { kind: 'cooldown', startIndex: 3, endIndex: 3, meters: 600 },
  ],
}

describe('toGpx', () => {
  it('renders a GPX 1.1 track with one trkpt per point', () => {
    const gpx = toGpx(route, 'Intervals 6x800m')
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(gpx).toContain('<gpx version="1.1"')
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"')
    expect(gpx.match(/<trkpt /g)).toHaveLength(4)
    expect(gpx).toContain('lat="51.44"')
    expect(gpx).toContain('lon="-2.58"')
    expect(gpx).toContain('<name>Intervals 6x800m</name>')
  })

  it('marks work start and end as waypoints for multi-phase routes', () => {
    const gpx = toGpx(route, 'Intervals')
    expect(gpx).toContain('<name>Work start</name>')
    expect(gpx).toContain('<name>Work end</name>')
  })

  it('omits waypoints for single-phase loop routes', () => {
    const loop: AssembledRoute = {
      points: route.points,
      totalMeters: 8000,
      phases: [{ kind: 'work', startIndex: 0, endIndex: 3, meters: 8000 }],
    }
    expect(toGpx(loop, 'Easy run')).not.toContain('<wpt')
  })

  it('escapes XML in names', () => {
    expect(toGpx(route, 'Reps & <hills>')).toContain('<name>Reps &amp; &lt;hills&gt;</name>')
  })
})
