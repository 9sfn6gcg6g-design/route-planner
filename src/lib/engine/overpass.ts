import type { LatLon, OsmWay } from './types'

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

const RUNNABLE_HIGHWAYS = [
  'residential',
  'living_street',
  'footway',
  'path',
  'cycleway',
  'track',
  'pedestrian',
  'tertiary',
  'unclassified',
  'service',
  'primary',
  'secondary',
  'trunk',
]

export function buildOverpassQuery(center: LatLon, radiusMeters: number): string {
  const filter = `^(${RUNNABLE_HIGHWAYS.join('|')})$`
  return [
    '[out:json][timeout:25];',
    '(',
    `  way(around:${radiusMeters},${center.lat},${center.lon})["highway"~"${filter}"];`,
    ');',
    'out geom qt;',
  ].join('\n')
}

interface OverpassElement {
  type: string
  id: number
  tags?: Record<string, string>
  nodes?: number[]
  geometry?: Array<{ lat: number; lon: number }>
}

export function parseOverpassResponse(body: unknown): OsmWay[] {
  const elements = (body as { elements?: unknown }).elements
  if (!Array.isArray(elements)) {
    throw new Error('Overpass response has no elements array')
  }
  const ways: OsmWay[] = []
  for (const el of elements as OverpassElement[]) {
    if (el.type !== 'way' || !el.nodes || !el.geometry || !el.tags?.highway) continue
    if (el.nodes.length !== el.geometry.length || el.nodes.length < 2) continue
    ways.push({
      id: el.id,
      tags: el.tags,
      nodeIds: el.nodes,
      points: el.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
    })
  }
  return ways
}

/** I/O glue — composition of tested parts; not unit-tested. */
export async function fetchWays(center: LatLon, radiusMeters: number): Promise<OsmWay[]> {
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: buildOverpassQuery(center, radiusMeters) }),
  })
  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status}`)
  }
  return parseOverpassResponse(await response.json())
}
