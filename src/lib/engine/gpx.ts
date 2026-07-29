import type { AssembledRoute } from './assemble'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render a route as GPX 1.1 — the universal course format watches import. */
export function toGpx(route: AssembledRoute, name: string): string {
  const safeName = escapeXml(name)
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="route-planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${safeName}</name></metadata>`,
  ]
  const work = route.phases.find((p) => p.kind === 'work')
  if (work && route.phases.length > 1) {
    const start = route.points[work.startIndex]
    const end = route.points[work.endIndex]
    lines.push(`  <wpt lat="${start.lat}" lon="${start.lon}"><name>Work start</name></wpt>`)
    lines.push(`  <wpt lat="${end.lat}" lon="${end.lon}"><name>Work end</name></wpt>`)
  }
  lines.push(`  <trk><name>${safeName}</name><trkseg>`)
  for (const point of route.points) {
    lines.push(`    <trkpt lat="${point.lat}" lon="${point.lon}"></trkpt>`)
  }
  lines.push('  </trkseg></trk>', '</gpx>', '')
  return lines.join('\n')
}
