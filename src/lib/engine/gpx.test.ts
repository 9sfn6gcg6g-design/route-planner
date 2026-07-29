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

  it('positions waypoints at correct work phase span boundaries', () => {
    const complexRoute: AssembledRoute = {
      points: [
        { lat: 50.0, lon: -1.0 },
        { lat: 50.1, lon: -1.1 },
        { lat: 50.2, lon: -1.2 },
        { lat: 50.3, lon: -1.3 },
        { lat: 50.4, lon: -1.4 },
        { lat: 50.5, lon: -1.5 },
      ],
      totalMeters: 6000,
      phases: [
        { kind: 'warmup', startIndex: 0, endIndex: 1, meters: 1000 },
        { kind: 'work', startIndex: 2, endIndex: 4, meters: 4000 },
        { kind: 'cooldown', startIndex: 5, endIndex: 5, meters: 1000 },
      ],
    }
    const gpx = toGpx(complexRoute, 'Test route')
    // Work start waypoint must have the exact coordinates of points[2]
    expect(gpx).toContain('<wpt lat="50.2" lon="-1.2"><name>Work start</name></wpt>')
    // Work end waypoint must have the exact coordinates of points[4]
    expect(gpx).toContain('<wpt lat="50.4" lon="-1.4"><name>Work end</name></wpt>')
  })
})
