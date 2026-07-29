import type { LatLon, OsmWay } from './types'

/**
 * Public Overpass instances, tried in order — the first is primary, the rest
 * are fallbacks. The public API is frequently overloaded (504) or bot-filtered
 * (406/429) under heavy queries, so relying on a single instance makes route
 * finding unreliable; fetchWays fails over between these.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]

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
  if (typeof body !== 'object' || body === null) {
    throw new Error('Overpass response has no elements array')
  }
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

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

export interface FetchWaysOptions {
  /** Instances to try in order. Defaults to OVERPASS_ENDPOINTS. */
  endpoints?: string[]
  /** Extra attempts per endpoint after the first, for transient failures. Default 2. */
  retriesPerEndpoint?: number
  /** Base backoff between attempts, ms (grows per attempt, plus jitter). Default 600; tests pass 0. */
  backoffMs?: number
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: FetchImpl
}

/** Every Overpass instance refused or errored — surface as "busy, try again". */
export class OverpassUnavailableError extends Error {}

/** A status worth retrying or failing over to another mirror for. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 406 || status >= 500
}

const wait = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))

/** Growing backoff with jitter, so retries against a busy instance spread out. */
export const backoffFor = (baseMs: number, attempt: number): number =>
  baseMs <= 0 ? 0 : baseMs * (attempt + 1) + Math.random() * baseMs

/**
 * I/O glue over the pure query builder + parser, hardened for the flaky public
 * Overpass instances: try each endpoint in turn, retrying transient failures
 * (429/406/5xx and network errors) with a growing backoff, then fall through to
 * the next mirror. A non-transient status skips straight to the next mirror.
 * Throws OverpassUnavailableError only when every instance has failed.
 */
export async function fetchWays(
  center: LatLon,
  radiusMeters: number,
  options: FetchWaysOptions = {},
): Promise<OsmWay[]> {
  const {
    endpoints = OVERPASS_ENDPOINTS,
    retriesPerEndpoint = 2,
    backoffMs = 600,
    fetchImpl = fetch,
  } = options
  const data = buildOverpassQuery(center, radiusMeters)
  const failures: string[] = []

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt <= retriesPerEndpoint; attempt++) {
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data }),
        })
        if (response.ok) return parseOverpassResponse(await response.json())
        failures.push(`${endpoint} → ${response.status}`)
        if (!isTransientStatus(response.status)) break
      } catch (err) {
        failures.push(`${endpoint} → ${err instanceof Error ? err.message : 'network error'}`)
      }
      if (attempt < retriesPerEndpoint) await wait(backoffFor(backoffMs, attempt))
    }
  }

  throw new OverpassUnavailableError(`all Overpass instances failed (${failures.join('; ')})`)
}
