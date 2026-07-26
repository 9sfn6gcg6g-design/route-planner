# Route Engine A: OSM Ingestion, Graph, and Signals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data layer of the route engine: fetch runnable OSM ways around a point, build a junction-split local graph, and annotate every edge with the signals the segment scorer needs (quietness, surface, length, gradient).

**Architecture:** Pure TypeScript under `src/lib/engine/`, mirroring the domain module's style: pure query-builders and parsers (unit-tested against a committed fixture of real Bristol data) wrapped by thin `fetch` glue (untested I/O). `graph.ts` splits OSM ways at junction nodes into `RunEdge`s; `signals.ts` maps OSM tags to the 0–1 quietness score and a surface class; `elevation.ts` enriches point sequences via Open-Meteo. Plan B (segment finder + laps) consumes `RunGraph` + `TerrainRequirements`; nothing here imports domain code except shared scale conventions.

**Tech Stack:** TypeScript, Vitest, global `fetch` (Node 20+), Overpass API (form-encoded POST, `out geom`), Open-Meteo Elevation API (batch ≤100 coords).

## Global Constraints

- All distances **meters**; quietness **0–1 (1 = quietest)**; gradients **percent** — same conventions as `src/lib/domain/` (do not import from domain in this plan; alignment is by convention).
- Quietness values must satisfy the domain profiles' thresholds meaningfully: residential = 0.7 (the intervals `minQuietness` floor), paths/cycleways above it, primary/trunk far below.
- No `any` types; `npm run lint` and `npm test` must pass at every commit.
- API facts (verified live 2026-07-26, do not re-litigate): Overpass rejects raw-body POST with 406 — the query MUST be form-encoded as the `data` parameter; `out geom` returns ways with both `nodes` (ids) and `geometry` (lat/lon). Open-Meteo elevation takes comma-joined `latitude`/`longitude` lists (≤100 each) and returns `{"elevation":[...]}`.
- `steps` are excluded from the fetch query entirely (you can't run reps on stairs).
- Thin fetch wrappers (`fetchWays`, `fetchElevations`) are I/O glue: no unit tests required for them; everything they compose (query builders, parsers) must be pure and tested.
- Committed fixture is real OSM data → the fixture file must start with no comment (JSON), but Task 2 adds an attribution line to `docs/domain.md` crediting OpenStreetMap contributors (ODbL).
- Commit messages: conventional commits ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Geo primitives

**Files:**
- Create: `src/lib/engine/types.ts`
- Create: `src/lib/engine/geo.ts`
- Test: `src/lib/engine/geo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LatLon`, `haversineMeters(a: LatLon, b: LatLon): number`, `pathLengthMeters(points: LatLon[]): number`, `cumulativeMeters(points: LatLon[]): number[]`. Tasks 4–5 and Plan B consume all three functions.

- [ ] **Step 1: Write the shared types**

Create `src/lib/engine/types.ts`:

```ts
export interface LatLon {
  lat: number
  lon: number
}

/** One OSM way as returned by Overpass `out geom`, filtered to what we use. */
export interface OsmWay {
  id: number
  tags: Record<string, string>
  nodeIds: number[]
  points: LatLon[]
}

export type SurfaceKind = 'paved' | 'unpaved' | 'unknown'

/** A junction-to-junction slice of an OSM way, annotated with signals. */
export interface RunEdge {
  wayId: number
  fromNodeId: number
  toNodeId: number
  points: LatLon[]
  lengthMeters: number
  highway: string
  quietness: number
  surface: SurfaceKind
}

export interface RunGraph {
  edges: RunEdge[]
  junctionNodeIds: Set<number>
}
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/engine/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cumulativeMeters, haversineMeters, pathLengthMeters } from './geo'

describe('haversineMeters', () => {
  it('measures one degree of latitude as ~111.2km', () => {
    const d = haversineMeters({ lat: 51, lon: -2.5 }, { lat: 52, lon: -2.5 })
    expect(d).toBeGreaterThan(110_500)
    expect(d).toBeLessThan(111_500)
  })

  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 51.45, lon: -2.58 }, { lat: 51.45, lon: -2.58 })).toBe(0)
  })

  it('is symmetric', () => {
    const a = { lat: 51.4545, lon: -2.5879 }
    const b = { lat: 51.46, lon: -2.6 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})

describe('pathLengthMeters', () => {
  it('sums consecutive segment lengths', () => {
    const a = { lat: 51.45, lon: -2.58 }
    const b = { lat: 51.46, lon: -2.58 }
    const c = { lat: 51.47, lon: -2.58 }
    const direct = haversineMeters(a, b) + haversineMeters(b, c)
    expect(pathLengthMeters([a, b, c])).toBeCloseTo(direct, 6)
  })

  it('is zero for a single point or empty path', () => {
    expect(pathLengthMeters([{ lat: 51, lon: -2 }])).toBe(0)
    expect(pathLengthMeters([])).toBe(0)
  })
})

describe('cumulativeMeters', () => {
  it('starts at zero and ends at the total path length', () => {
    const pts = [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.46, lon: -2.58 },
      { lat: 51.47, lon: -2.58 },
    ]
    const cum = cumulativeMeters(pts)
    expect(cum).toHaveLength(3)
    expect(cum[0]).toBe(0)
    expect(cum[2]).toBeCloseTo(pathLengthMeters(pts), 6)
    expect(cum[1]).toBeGreaterThan(0)
    expect(cum[1]).toBeLessThan(cum[2])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './geo'`.

- [ ] **Step 4: Implement**

Create `src/lib/engine/geo.ts`:

```ts
import type { LatLon } from './types'

const EARTH_RADIUS_METERS = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLon * sinLon
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}

export function pathLengthMeters(points: LatLon[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i])
  }
  return total
}

/** Running distance from the first point to each point, same length as input. */
export function cumulativeMeters(points: LatLon[]): number[] {
  const cum: number[] = []
  let total = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += haversineMeters(points[i - 1], points[i])
    cum.push(total)
  }
  return cum
}
```

- [ ] **Step 5: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: engine geo primitives (haversine, path length)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Overpass query builder, parser, and fixture

**Files:**
- Create: `src/lib/engine/overpass.ts`
- Create: `src/lib/engine/__fixtures__/overpass-bristol.json` (fetched live in Step 1)
- Modify: `docs/domain.md` (append OSM attribution line)
- Test: `src/lib/engine/overpass.test.ts`

**Interfaces:**
- Consumes: `LatLon`, `OsmWay` from `./types`.
- Produces: `buildOverpassQuery(center: LatLon, radiusMeters: number): string`, `parseOverpassResponse(body: unknown): OsmWay[]`, `fetchWays(center: LatLon, radiusMeters: number): Promise<OsmWay[]>` (thin glue). Task 4 and Plan B consume `OsmWay[]`; the fixture is the standard test input for Task 4.

- [ ] **Step 1: Fetch the fixture (real data, committed)**

```bash
mkdir -p src/lib/engine/__fixtures__
cat > /tmp/rp-overpass-fixture-query.txt <<'EOF'
[out:json][timeout:25];
(
  way(around:800,51.4545,-2.5879)["highway"~"^(residential|living_street|footway|path|cycleway|track|pedestrian|tertiary|unclassified|service|primary|secondary|trunk)$"];
);
out geom qt 80;
EOF
curl -s --max-time 40 https://overpass-api.de/api/interpreter \
  --data-urlencode data@/tmp/rp-overpass-fixture-query.txt \
  -o src/lib/engine/__fixtures__/overpass-bristol.json
python3 -c "import json; d=json.load(open('src/lib/engine/__fixtures__/overpass-bristol.json')); ways=[e for e in d['elements'] if e['type']=='way']; assert len(ways) >= 20, len(ways); assert all('geometry' in w and 'nodes' in w for w in ways); print('fixture OK:', len(ways), 'ways')"
```

Expected: `fixture OK: <N> ways` with N ≥ 20. If the public endpoint times out, retry once; if it still fails, report BLOCKED (do not hand-craft the fixture).

- [ ] **Step 2: Write failing tests**

Create `src/lib/engine/overpass.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/overpass-bristol.json'
import { buildOverpassQuery, parseOverpassResponse } from './overpass'

describe('buildOverpassQuery', () => {
  it('targets the given center and radius with geometry output', () => {
    const q = buildOverpassQuery({ lat: 51.4545, lon: -2.5879 }, 1200)
    expect(q).toContain('around:1200,51.4545,-2.5879')
    expect(q).toContain('out geom')
    expect(q).toContain('[out:json]')
  })

  it('excludes steps from the highway filter', () => {
    const q = buildOverpassQuery({ lat: 51.4545, lon: -2.5879 }, 1200)
    expect(q).not.toContain('steps')
    expect(q).toContain('residential')
    expect(q).toContain('footway')
  })
})

describe('parseOverpassResponse', () => {
  it('parses the committed Bristol fixture into ways with geometry', () => {
    const ways = parseOverpassResponse(fixture)
    expect(ways.length).toBeGreaterThanOrEqual(20)
    for (const way of ways) {
      expect(way.id).toBeGreaterThan(0)
      expect(way.nodeIds.length).toBeGreaterThanOrEqual(2)
      expect(way.points.length).toBe(way.nodeIds.length)
      expect(typeof way.tags.highway).toBe('string')
      for (const p of way.points) {
        expect(p.lat).toBeGreaterThan(51.4)
        expect(p.lat).toBeLessThan(51.5)
        expect(p.lon).toBeGreaterThan(-2.7)
        expect(p.lon).toBeLessThan(-2.5)
      }
    }
  })

  it('ignores non-way elements and ways without geometry', () => {
    const ways = parseOverpassResponse({
      elements: [
        { type: 'node', id: 1, lat: 51, lon: -2 },
        { type: 'way', id: 2, tags: { highway: 'residential' } },
        {
          type: 'way',
          id: 3,
          tags: { highway: 'residential' },
          nodes: [10, 11],
          geometry: [
            { lat: 51.45, lon: -2.58 },
            { lat: 51.46, lon: -2.58 },
          ],
        },
      ],
    })
    expect(ways).toHaveLength(1)
    expect(ways[0].id).toBe(3)
  })

  it('throws on a body with no elements array', () => {
    expect(() => parseOverpassResponse({ remark: 'timeout' })).toThrow(/elements/)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './overpass'`. (If the fixture import itself errors, `tsconfig.json` already has `"resolveJsonModule": true` from create-next-app — verify before assuming test design is wrong.)

- [ ] **Step 4: Implement**

Create `src/lib/engine/overpass.ts`:

```ts
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
```

- [ ] **Step 5: Append OSM attribution to docs/domain.md**

Append to the end of `docs/domain.md`:

```markdown

---

Map data in test fixtures © OpenStreetMap contributors, licensed under ODbL (openstreetmap.org/copyright).
```

- [ ] **Step 6: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine docs/domain.md
git commit -m "$(cat <<'EOF'
feat: overpass query builder, parser, and Bristol fixture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Signal scoring (quietness + surface)

**Files:**
- Create: `src/lib/engine/signals.ts`
- Test: `src/lib/engine/signals.test.ts`

**Interfaces:**
- Consumes: `SurfaceKind` from `./types`.
- Produces: `quietnessFor(tags: Record<string, string>): number`, `surfaceKindFor(tags: Record<string, string>): SurfaceKind`. Task 4 stamps both onto every `RunEdge`; Plan B compares them against `TerrainRequirements`.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/signals.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { quietnessFor, surfaceKindFor } from './signals'

describe('quietnessFor', () => {
  it('rates car-free ways quietest', () => {
    expect(quietnessFor({ highway: 'footway' })).toBe(0.9)
    expect(quietnessFor({ highway: 'path' })).toBe(0.9)
    expect(quietnessFor({ highway: 'cycleway' })).toBe(0.9)
    expect(quietnessFor({ highway: 'pedestrian' })).toBe(0.9)
    expect(quietnessFor({ highway: 'track' })).toBe(0.9)
  })

  it('rates residential at exactly the intervals threshold', () => {
    expect(quietnessFor({ highway: 'residential' })).toBe(0.7)
  })

  it('rates busier road classes progressively lower', () => {
    const order = ['living_street', 'residential', 'service', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk']
    const scores = order.map((h) => quietnessFor({ highway: h }))
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
    }
    expect(quietnessFor({ highway: 'trunk' })).toBe(0.1)
  })

  it('defaults unknown highway values to a low-mid score', () => {
    expect(quietnessFor({ highway: 'road' })).toBe(0.5)
    expect(quietnessFor({})).toBe(0.5)
  })
})

describe('surfaceKindFor', () => {
  it('maps explicit paved surfaces', () => {
    expect(surfaceKindFor({ surface: 'asphalt' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'paving_stones' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'concrete' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'paved' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'sett' })).toBe('paved')
  })

  it('maps explicit unpaved surfaces', () => {
    for (const s of ['gravel', 'dirt', 'grass', 'ground', 'unpaved', 'sand', 'mud', 'fine_gravel', 'compacted', 'earth', 'wood']) {
      expect(surfaceKindFor({ surface: s })).toBe('unpaved')
    }
  })

  it('infers pavement from highway class when surface is missing', () => {
    expect(surfaceKindFor({ highway: 'residential' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'pedestrian' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'cycleway' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'path' })).toBe('unpaved')
    expect(surfaceKindFor({ highway: 'track' })).toBe('unpaved')
  })

  it('returns unknown when neither surface nor a known highway is present', () => {
    expect(surfaceKindFor({})).toBe('unknown')
    expect(surfaceKindFor({ surface: 'weird_value' })).toBe('unknown')
  })

  it('prefers the explicit surface tag over highway inference', () => {
    expect(surfaceKindFor({ highway: 'path', surface: 'asphalt' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'residential', surface: 'gravel' })).toBe('unpaved')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './signals'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/signals.ts`:

```ts
import type { SurfaceKind } from './types'

/**
 * Road-class proxy for quietness (0–1, 1 = quietest) — the MVP signal per
 * decision #6/#7 in docs/domain.md. Residential is pinned to 0.7, the
 * intervals profile's minQuietness floor, so intervals accept residential
 * streets and everything busier fails.
 */
const QUIETNESS_BY_HIGHWAY: Record<string, number> = {
  footway: 0.9,
  path: 0.9,
  cycleway: 0.9,
  pedestrian: 0.9,
  track: 0.9,
  living_street: 0.85,
  residential: 0.7,
  service: 0.6,
  unclassified: 0.6,
  tertiary: 0.45,
  secondary: 0.3,
  primary: 0.2,
  trunk: 0.1,
}

const DEFAULT_QUIETNESS = 0.5

export function quietnessFor(tags: Record<string, string>): number {
  const highway = tags.highway
  if (highway && highway in QUIETNESS_BY_HIGHWAY) {
    return QUIETNESS_BY_HIGHWAY[highway]
  }
  return DEFAULT_QUIETNESS
}

const PAVED_SURFACES = new Set([
  'asphalt',
  'paved',
  'concrete',
  'paving_stones',
  'sett',
  'concrete:plates',
  'concrete:lanes',
  'chipseal',
])

const UNPAVED_SURFACES = new Set([
  'unpaved',
  'gravel',
  'fine_gravel',
  'compacted',
  'dirt',
  'earth',
  'grass',
  'ground',
  'mud',
  'sand',
  'wood',
  'woodchips',
  'pebblestone',
])

/** Highway classes that are near-always paved (unpaved) when surface is untagged. */
const PAVED_BY_DEFAULT = new Set([
  'residential',
  'living_street',
  'pedestrian',
  'cycleway',
  'service',
  'unclassified',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'footway',
])

const UNPAVED_BY_DEFAULT = new Set(['path', 'track'])

export function surfaceKindFor(tags: Record<string, string>): SurfaceKind {
  const surface = tags.surface
  if (surface) {
    if (PAVED_SURFACES.has(surface)) return 'paved'
    if (UNPAVED_SURFACES.has(surface)) return 'unpaved'
    return 'unknown'
  }
  const highway = tags.highway
  if (highway) {
    if (PAVED_BY_DEFAULT.has(highway)) return 'paved'
    if (UNPAVED_BY_DEFAULT.has(highway)) return 'unpaved'
  }
  return 'unknown'
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: quietness and surface signals from OSM tags

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Graph builder (junction-split edges)

**Files:**
- Create: `src/lib/engine/graph.ts`
- Test: `src/lib/engine/graph.test.ts`

**Interfaces:**
- Consumes: `OsmWay`, `RunEdge`, `RunGraph` from `./types`; `pathLengthMeters` from `./geo`; `quietnessFor`, `surfaceKindFor` from `./signals`; the Bristol fixture + `parseOverpassResponse` from `./overpass` (test only).
- Produces: `buildGraph(ways: OsmWay[]): RunGraph`. Plan B's segment finder walks this graph.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/overpass-bristol.json'
import { buildGraph } from './graph'
import { parseOverpassResponse } from './overpass'
import { pathLengthMeters } from './geo'
import type { OsmWay } from './types'

function way(id: number, nodeIds: number[], lats: number[], highway = 'residential'): OsmWay {
  return {
    id,
    tags: { highway },
    nodeIds,
    points: lats.map((lat, i) => ({ lat, lon: -2.58 - i * 0.0001 })),
  }
}

describe('buildGraph', () => {
  it('keeps an isolated way as a single edge', () => {
    const graph = buildGraph([way(1, [10, 11, 12], [51.45, 51.451, 51.452])])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].fromNodeId).toBe(10)
    expect(graph.edges[0].toNodeId).toBe(12)
    expect(graph.edges[0].points).toHaveLength(3)
    expect(graph.junctionNodeIds.size).toBe(0)
  })

  it('splits two crossing ways at their shared node into four edges', () => {
    // way 1: 10 - 20 - 12 ; way 2: 30 - 20 - 32 (junction at 20)
    const a = way(1, [10, 20, 12], [51.45, 51.451, 51.452])
    const b = way(2, [30, 20, 32], [51.46, 51.451, 51.462])
    const graph = buildGraph([a, b])
    expect(graph.junctionNodeIds.has(20)).toBe(true)
    expect(graph.edges).toHaveLength(4)
    const boundaries = graph.edges.map((e) => [e.fromNodeId, e.toNodeId])
    expect(boundaries).toContainEqual([10, 20])
    expect(boundaries).toContainEqual([20, 12])
    expect(boundaries).toContainEqual([30, 20])
    expect(boundaries).toContainEqual([20, 32])
  })

  it('does not split when ways merely touch end-to-end', () => {
    // way 1 ends at 20; way 2 starts at 20 — shared endpoint is a junction node,
    // but each way still yields one edge (no interior split point).
    const a = way(1, [10, 11, 20], [51.45, 51.451, 51.452])
    const b = way(2, [20, 21, 22], [51.452, 51.453, 51.454])
    const graph = buildGraph([a, b])
    expect(graph.edges).toHaveLength(2)
    expect(graph.junctionNodeIds.has(20)).toBe(true)
  })

  it('computes edge length from geometry and stamps signals from tags', () => {
    const w = way(1, [10, 11], [51.45, 51.46], 'footway')
    const graph = buildGraph([w])
    expect(graph.edges[0].lengthMeters).toBeCloseTo(pathLengthMeters(w.points), 6)
    expect(graph.edges[0].highway).toBe('footway')
    expect(graph.edges[0].quietness).toBe(0.9)
    expect(graph.edges[0].surface).toBe('paved')
    expect(graph.edges[0].wayId).toBe(1)
  })

  it('builds a coherent graph from the real Bristol fixture', () => {
    const ways = parseOverpassResponse(fixture)
    const graph = buildGraph(ways)
    expect(graph.edges.length).toBeGreaterThanOrEqual(ways.length)
    for (const edge of graph.edges) {
      expect(edge.lengthMeters).toBeGreaterThan(0)
      expect(edge.points.length).toBeGreaterThanOrEqual(2)
      expect(edge.quietness).toBeGreaterThan(0)
      expect(edge.quietness).toBeLessThanOrEqual(1)
    }
    expect(graph.junctionNodeIds.size).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './graph'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/graph.ts`:

```ts
import type { OsmWay, RunEdge, RunGraph } from './types'
import { pathLengthMeters } from './geo'
import { quietnessFor, surfaceKindFor } from './signals'

/**
 * A junction is any node used by more than one way (crossing or shared
 * endpoint). Each way is split at interior junction nodes so every edge
 * runs junction-to-junction (or way-end-to-way-end) with no crossings
 * inside it — which is exactly what "uninterrupted stretch" means to the
 * segment finder.
 */
export function buildGraph(ways: OsmWay[]): RunGraph {
  const usage = new Map<number, number>()
  for (const way of ways) {
    const seen = new Set<number>()
    for (const nodeId of way.nodeIds) {
      if (seen.has(nodeId)) continue // self-revisits don't make a junction
      seen.add(nodeId)
      usage.set(nodeId, (usage.get(nodeId) ?? 0) + 1)
    }
  }
  const junctionNodeIds = new Set<number>()
  for (const [nodeId, count] of usage) {
    if (count > 1) junctionNodeIds.add(nodeId)
  }

  const edges: RunEdge[] = []
  for (const way of ways) {
    const quietness = quietnessFor(way.tags)
    const surface = surfaceKindFor(way.tags)
    const highway = way.tags.highway
    let sliceStart = 0
    for (let i = 1; i < way.nodeIds.length; i++) {
      const isLast = i === way.nodeIds.length - 1
      if (!isLast && !junctionNodeIds.has(way.nodeIds[i])) continue
      const points = way.points.slice(sliceStart, i + 1)
      edges.push({
        wayId: way.id,
        fromNodeId: way.nodeIds[sliceStart],
        toNodeId: way.nodeIds[i],
        points,
        lengthMeters: pathLengthMeters(points),
        highway,
        quietness,
        surface,
      })
      sliceStart = i
    }
  }

  return { edges, junctionNodeIds }
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: junction-split run graph from OSM ways

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Elevation enrichment

**Files:**
- Create: `src/lib/engine/elevation.ts`
- Test: `src/lib/engine/elevation.test.ts`

**Interfaces:**
- Consumes: `LatLon` from `./types`; `cumulativeMeters` from `./geo`.
- Produces: `chunk<T>(items: T[], size: number): T[][]`, `buildElevationUrl(points: LatLon[]): string`, `parseElevationResponse(body: unknown, expectedCount: number): number[]`, `avgAbsGradientPercent(elevations: number[], cumulative: number[]): number`, `fetchElevations(points: LatLon[]): Promise<number[]>` (thin glue, batches of 100). Plan B uses `avgAbsGradientPercent` against `TerrainRequirements.maxAvgGradientPercent` / `minAvgGradientPercent`.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/elevation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  avgAbsGradientPercent,
  buildElevationUrl,
  chunk,
  parseElevationResponse,
} from './elevation'

describe('chunk', () => {
  it('splits into batches of the given size with a smaller tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns one batch when under the size', () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]])
  })

  it('returns no batches for an empty list', () => {
    expect(chunk([], 100)).toEqual([])
  })
})

describe('buildElevationUrl', () => {
  it('joins coordinates into comma lists', () => {
    const url = buildElevationUrl([
      { lat: 51.4545, lon: -2.5879 },
      { lat: 51.455, lon: -2.588 },
    ])
    expect(url).toContain('api.open-meteo.com/v1/elevation')
    expect(url).toContain('latitude=51.4545,51.455')
    expect(url).toContain('longitude=-2.5879,-2.588')
  })
})

describe('parseElevationResponse', () => {
  it('returns the elevation array when the count matches', () => {
    expect(parseElevationResponse({ elevation: [11, 18, 26] }, 3)).toEqual([11, 18, 26])
  })

  it('throws when the count does not match the points sent', () => {
    expect(() => parseElevationResponse({ elevation: [11] }, 3)).toThrow(/expected 3/)
  })

  it('throws when the body has no elevation array', () => {
    expect(() => parseElevationResponse({ error: true }, 2)).toThrow(/elevation/)
  })
})

describe('avgAbsGradientPercent', () => {
  it('computes mean absolute gradient over the path', () => {
    // up 5m over 100m, down 5m over 100m -> (5+5)/200 = 5%
    expect(avgAbsGradientPercent([0, 5, 0], [0, 100, 200])).toBeCloseTo(5, 6)
  })

  it('is zero for flat ground', () => {
    expect(avgAbsGradientPercent([10, 10, 10], [0, 50, 120])).toBe(0)
  })

  it('is zero for degenerate paths (fewer than two points or zero length)', () => {
    expect(avgAbsGradientPercent([5], [0])).toBe(0)
    expect(avgAbsGradientPercent([5, 6], [0, 0])).toBe(0)
  })

  it('throws when array lengths differ', () => {
    expect(() => avgAbsGradientPercent([0, 5], [0])).toThrow(/length/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './elevation'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/elevation.ts`:

```ts
import type { LatLon } from './types'

const ELEVATION_ENDPOINT = 'https://api.open-meteo.com/v1/elevation'

/** Open-Meteo accepts at most 100 coordinates per request. */
const MAX_COORDS_PER_REQUEST = 100

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

export function buildElevationUrl(points: LatLon[]): string {
  const latitude = points.map((p) => p.lat).join(',')
  const longitude = points.map((p) => p.lon).join(',')
  return `${ELEVATION_ENDPOINT}?latitude=${latitude}&longitude=${longitude}`
}

export function parseElevationResponse(body: unknown, expectedCount: number): number[] {
  const elevation = (body as { elevation?: unknown }).elevation
  if (!Array.isArray(elevation) || elevation.some((e) => typeof e !== 'number')) {
    throw new Error('Open-Meteo response has no elevation array')
  }
  if (elevation.length !== expectedCount) {
    throw new Error(`Open-Meteo returned ${elevation.length} elevations, expected ${expectedCount}`)
  }
  return elevation as number[]
}

/**
 * Mean |gradient| in percent across the path: total absolute climb+descent
 * divided by total distance. `cumulative` is running distance in meters
 * (from cumulativeMeters), same length as `elevations`.
 */
export function avgAbsGradientPercent(elevations: number[], cumulative: number[]): number {
  if (elevations.length !== cumulative.length) {
    throw new Error('elevations and cumulative distances must have the same length')
  }
  if (elevations.length < 2) return 0
  const totalDistance = cumulative[cumulative.length - 1] - cumulative[0]
  if (totalDistance <= 0) return 0
  let totalAbsRise = 0
  for (let i = 1; i < elevations.length; i++) {
    totalAbsRise += Math.abs(elevations[i] - elevations[i - 1])
  }
  return (totalAbsRise / totalDistance) * 100
}

/** I/O glue — composition of tested parts; not unit-tested. */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  const results: number[] = []
  for (const batch of chunk(points, MAX_COORDS_PER_REQUEST)) {
    const response = await fetch(buildElevationUrl(batch))
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed: ${response.status}`)
    }
    results.push(...parseElevationResponse(await response.json(), batch.length))
  }
  return results
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: open-meteo elevation enrichment and gradient stats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
