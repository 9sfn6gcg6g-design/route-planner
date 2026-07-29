import { describe, expect, it } from 'vitest'
import { buildGpxTrack } from './gpx'

const points = [
  { lat: 51.4545, lon: -2.5879 },
  { lat: 51.456, lon: -2.59 },
  { lat: 51.4571, lon: -2.5915 },
]

describe('buildGpxTrack', () => {
  it('emits a valid GPX 1.1 skeleton with one track and one segment', () => {
    const gpx = buildGpxTrack(points)
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true)
    expect(gpx).toContain('<gpx version="1.1" creator="route-planner"')
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"')
    expect(gpx.match(/<trk>/g)).toHaveLength(1)
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1)
    expect(gpx.endsWith('</gpx>\n')).toBe(true)
  })

  it('writes one trkpt per point, in order, with fixed-precision coords', () => {
    const gpx = buildGpxTrack(points)
    const pts = gpx.match(/<trkpt [^>]*>/g)
    expect(pts).toHaveLength(3)
    expect(pts?.[0]).toBe('<trkpt lat="51.4545000" lon="-2.5879000">')
    // order preserved
    expect(gpx.indexOf('51.4545000')).toBeLessThan(gpx.indexOf('51.4571000'))
  })

  it('omits <ele> when no elevations are given', () => {
    expect(buildGpxTrack(points)).not.toContain('<ele>')
  })

  it('includes index-aligned <ele> in meters when elevations are given', () => {
    const gpx = buildGpxTrack(points, { elevations: [12, 15.25, 9] })
    expect(gpx).toContain('<ele>12.0</ele>')
    expect(gpx).toContain('<ele>15.3</ele>')
    expect(gpx).toContain('<ele>9.0</ele>')
  })

  it('includes and XML-escapes the track name', () => {
    const gpx = buildGpxTrack(points, { name: '6x800m intervals <A&B>' })
    expect(gpx).toContain('<name>6x800m intervals &lt;A&amp;B&gt;</name>')
  })

  it('has no <name> element when no name is given', () => {
    expect(buildGpxTrack(points)).not.toContain('<name>')
  })

  it('throws when elevations length does not match points length', () => {
    expect(() => buildGpxTrack(points, { elevations: [1, 2] })).toThrow(/does not match/)
  })

  it('throws on a non-finite coordinate', () => {
    expect(() => buildGpxTrack([{ lat: Number.NaN, lon: -2.5 }])).toThrow(/finite/)
  })

  it('produces an empty but valid segment for no points', () => {
    const gpx = buildGpxTrack([])
    expect(gpx).toContain('<trkseg>\n    </trkseg>')
    expect(gpx).not.toContain('<trkpt')
  })
})
