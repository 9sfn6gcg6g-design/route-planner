# Route Engine B: Work-Segment Finder — Implementation Plan

**Status:** complete (landed 2026-07-28) · **Owner:** Liam

> Step checkboxes below were never ticked during execution, but the work
> shipped — `chains.ts`, `resample.ts`, `evaluate.ts`, `finder.ts` and their
> tests are on `main`. Trust `git log` and the code, not the boxes. On future
> plans, tick as you land each step and update this header when you claim or
> finish a plan (see `AGENTS.md`).
>
> **Deferred out of this plan:** sub-chain windowing (finding a qualifying 800m
> window inside a longer chain whose whole-chain gradient fails). Still open.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a `RunGraph`, a start point, and a work phase's `TerrainRequirements`, find and rank real uninterrupted stretches where the runner can do the session — the core product capability.

**Architecture:** Four pure modules in `src/lib/engine/`. `chains.ts` merges graph edges through degree-2 splice nodes into maximal uninterrupted chains (stopping only at true crossings, degree ≥ 3, and dead ends — and detecting pure cycles like park loops). `resample.ts` re-spaces chain geometry to a fixed interval so elevation sampling isn't distorted by OSM's ~7m point spacing against a ~90m DEM. `evaluate.ts` checks a chain against the domain's `TerrainRequirements` (fail-closed on unknown surface vs 'paved') and scores it; gradient is passed in, so evaluation stays pure and reusable for both the cheap prefilter (gradient = null) and the full check. `finder.ts` orchestrates: build chains → distance + static prefilter → elevation via an **injected sampler** (tests use fakes; production passes `fetchElevations`) → evaluate → rank. This plan introduces the engine's first import from `src/lib/domain/` (type-only, one-directional) — the finder exists to serve domain requirements.

**Tech Stack:** TypeScript, Vitest. No new dependencies, no network in tests.

## Global Constraints

- Distances meters; gradients percent; quietness 0–1. No `any` types; `npm run lint` and `npm test` pass at every commit.
- Chains contain no interior degree-≥3 nodes **by construction**, so `maxJunctionsPerKm` is automatically satisfied for stretch segments — do not add a junction-density check; document this where noted.
- Fail-closed surface policy (decision of record): `surface: 'paved'` requirement rejects `'unknown'` edges; `'any'` accepts all.
- Elevation frugality: the finder must not call the elevation sampler for chains that already fail distance or static checks — tests enforce this with call-recording fakes.
- Engine → domain imports are **type-only** (`import type { TerrainRequirements } from '@/lib/domain/types'`); never import domain functions, never import engine code from domain.
- Sub-chain windowing (finding a qualifying 800m window inside a 2km chain whose average gradient fails) is OUT of this plan — whole-chain evaluation only; note it as a future refinement where indicated.
- Commit messages: conventional commits ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Chain builder (merge through splices)

**Files:**
- Modify: `src/lib/engine/types.ts` (append `Chain`)
- Create: `src/lib/engine/chains.ts`
- Test: `src/lib/engine/chains.test.ts`

**Interfaces:**
- Consumes: `RunGraph`, `RunEdge`, `LatLon` from `./types`.
- Produces: `Chain` type and `buildChains(graph: RunGraph): Chain[]`. Tasks 3–4 consume `Chain`; Plan C routes connectors to chain endpoints.

- [ ] **Step 1: Append the Chain type**

Append to `src/lib/engine/types.ts`:

```ts
/**
 * A maximal uninterrupted stretch: graph edges merged through degree-2
 * splice nodes, terminating only at true crossings (degree >= 3), dead
 * ends (degree 1), or — for isolated loops like a park circuit — closing
 * back on the start (isCycle).
 */
export interface Chain {
  edges: RunEdge[]
  points: LatLon[]
  lengthMeters: number
  startNodeId: number
  endNodeId: number
  isCycle: boolean
}
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/engine/chains.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/overpass-bristol.json'
import { buildChains } from './chains'
import { buildGraph } from './graph'
import { parseOverpassResponse } from './overpass'
import type { OsmWay } from './types'

function way(id: number, nodeIds: number[], lats: number[], highway = 'residential'): OsmWay {
  return {
    id,
    tags: { highway },
    nodeIds,
    points: lats.map((lat, i) => ({ lat, lon: -2.58 - i * 0.0001 })),
  }
}

describe('buildChains', () => {
  it('merges two ways joined end-to-end at a degree-2 splice into one chain', () => {
    const graph = buildGraph([
      way(1, [10, 11, 20], [51.45, 51.451, 51.452]),
      way(2, [20, 21, 22], [51.452, 51.453, 51.454]),
    ])
    const chains = buildChains(graph)
    expect(chains).toHaveLength(1)
    expect(chains[0].edges).toHaveLength(2)
    expect(chains[0].points).toHaveLength(5) // 3 + 3 minus shared endpoint
    expect(chains[0].isCycle).toBe(false)
    const ends = [chains[0].startNodeId, chains[0].endNodeId].sort()
    expect(ends).toEqual([10, 22])
    const total = graph.edges.reduce((s, e) => s + e.lengthMeters, 0)
    expect(chains[0].lengthMeters).toBeCloseTo(total, 6)
  })

  it('reverses edge geometry when walking against way direction', () => {
    // way 2 points AWAY from the splice: 12 -> 11; walking 10 -> 11 -> 12 must reverse it
    const a = way(1, [10, 11], [51.45, 51.451])
    const b = way(2, [12, 11], [51.452, 51.451])
    const chains = buildChains(buildGraph([a, b]))
    expect(chains).toHaveLength(1)
    const lats = chains[0].points.map((p) => p.lat)
    // walking 10 -> 11 -> 12 must yield strictly increasing latitudes;
    // without reversal, way 2's geometry would appear backwards and
    // duplicate the splice point
    expect(lats).toHaveLength(3)
    expect(lats).toEqual([...lats].sort((x, y) => x - y))
    expect(new Set(lats).size).toBe(3)
  })

  it('stops chains at true crossings (degree >= 3)', () => {
    // ways crossing at node 20: every edge is its own chain
    const graph = buildGraph([
      way(1, [10, 20, 12], [51.45, 51.451, 51.452]),
      way(2, [30, 20, 32], [51.46, 51.451, 51.462]),
    ])
    const chains = buildChains(graph)
    expect(chains).toHaveLength(4)
    for (const chain of chains) {
      expect(chain.edges).toHaveLength(1)
    }
  })

  it('detects an isolated closed loop as a cycle', () => {
    const graph = buildGraph([way(1, [10, 11, 12, 10], [51.45, 51.451, 51.4505, 51.45])])
    const chains = buildChains(graph)
    expect(chains).toHaveLength(1)
    expect(chains[0].isCycle).toBe(true)
    expect(chains[0].startNodeId).toBe(chains[0].endNodeId)
    expect(chains[0].lengthMeters).toBeGreaterThan(0)
  })

  it('consumes every edge exactly once on the real Bristol fixture', () => {
    const graph = buildGraph(parseOverpassResponse(fixture))
    const chains = buildChains(graph)
    const chainEdgeCount = chains.reduce((s, c) => s + c.edges.length, 0)
    expect(chainEdgeCount).toBe(graph.edges.length)
    const chainLength = chains.reduce((s, c) => s + c.lengthMeters, 0)
    const edgeLength = graph.edges.reduce((s, e) => s + e.lengthMeters, 0)
    expect(chainLength).toBeCloseTo(edgeLength, 4)
    // merging through splices must actually happen on real data
    expect(chains.length).toBeLessThan(graph.edges.length)
    for (const chain of chains) {
      expect(chain.points.length).toBeGreaterThanOrEqual(2)
      expect(chain.lengthMeters).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './chains'`.

- [ ] **Step 4: Implement**

Create `src/lib/engine/chains.ts`:

```ts
import type { Chain, RunEdge, RunGraph } from './types'

function addIncident(adjacency: Map<number, RunEdge[]>, nodeId: number, edge: RunEdge): void {
  const list = adjacency.get(nodeId)
  if (list) list.push(edge)
  else adjacency.set(nodeId, [edge])
}

/**
 * Merge edges through degree-2 splice nodes into maximal chains. A chain
 * ends only at a true crossing (degree >= 3), a dead end (degree 1), or by
 * closing back on its start (pure degree-2 cycles, e.g. a park loop).
 * Interior nodes are all degree-2 by construction, so a chain has no
 * crossings inside it — this is what makes chain length the honest
 * "uninterrupted stretch" measure the domain's minUninterruptedMeters
 * asks about.
 */
export function buildChains(graph: RunGraph): Chain[] {
  const adjacency = new Map<number, RunEdge[]>()
  for (const edge of graph.edges) {
    addIncident(adjacency, edge.fromNodeId, edge)
    if (edge.toNodeId !== edge.fromNodeId) addIncident(adjacency, edge.toNodeId, edge)
  }
  const degree = (nodeId: number): number => graph.nodeDegree.get(nodeId) ?? 0
  const visited = new Set<RunEdge>()
  const chains: Chain[] = []

  const walk = (startNodeId: number, firstEdge: RunEdge): Chain => {
    const edges: RunEdge[] = []
    const points: Chain['points'] = []
    let nodeId = startNodeId
    let edge: RunEdge | undefined = firstEdge
    while (edge && !visited.has(edge)) {
      visited.add(edge)
      edges.push(edge)
      const forward = edge.fromNodeId === nodeId
      const oriented = forward ? edge.points : [...edge.points].reverse()
      if (points.length === 0) points.push(...oriented)
      else points.push(...oriented.slice(1))
      nodeId = forward ? edge.toNodeId : edge.fromNodeId
      if (degree(nodeId) !== 2) break
      edge = (adjacency.get(nodeId) ?? []).find((e) => !visited.has(e))
    }
    return {
      edges,
      points,
      lengthMeters: edges.reduce((sum, e) => sum + e.lengthMeters, 0),
      startNodeId,
      endNodeId: nodeId,
      isCycle: nodeId === startNodeId && edges.length > 0,
    }
  }

  // Pass 1: start every chain from a terminal (dead end or true crossing).
  for (const edge of graph.edges) {
    if (visited.has(edge)) continue
    if (degree(edge.fromNodeId) !== 2) chains.push(walk(edge.fromNodeId, edge))
    else if (degree(edge.toNodeId) !== 2) chains.push(walk(edge.toNodeId, edge))
  }
  // Pass 2: whatever remains is a pure degree-2 cycle.
  for (const edge of graph.edges) {
    if (visited.has(edge)) continue
    chains.push(walk(edge.fromNodeId, edge))
  }
  return chains
}
```

- [ ] **Step 5: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: chain builder merging edges through degree-2 splices

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Geometry resampling

**Files:**
- Create: `src/lib/engine/resample.ts`
- Test: `src/lib/engine/resample.test.ts`

**Interfaces:**
- Consumes: `LatLon` from `./types`; `haversineMeters` from `./geo`.
- Produces: `resamplePoints(points: LatLon[], intervalMeters: number): LatLon[]`. Task 4 resamples chain geometry before elevation sampling.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/resample.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { haversineMeters } from './geo'
import { resamplePoints } from './resample'

describe('resamplePoints', () => {
  it('re-spaces a long straight segment to the given interval', () => {
    // ~1000m due north in a single segment
    const line = [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.459, lon: -2.58 },
    ]
    const resampled = resamplePoints(line, 100)
    expect(resampled.length).toBeGreaterThanOrEqual(11)
    expect(resampled[0]).toEqual(line[0])
    expect(resampled[resampled.length - 1]).toEqual(line[1])
    for (let i = 1; i < resampled.length - 1; i++) {
      expect(haversineMeters(resampled[i - 1], resampled[i])).toBeCloseTo(100, 0)
    }
  })

  it('keeps endpoints when the interval exceeds the path length', () => {
    const short = [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.4501, lon: -2.58 },
    ]
    expect(resamplePoints(short, 500)).toEqual(short)
  })

  it('passes through degenerate inputs', () => {
    const p = { lat: 51.45, lon: -2.58 }
    expect(resamplePoints([p], 50)).toEqual([p])
    expect(resamplePoints([], 50)).toEqual([])
  })

  it('throws on a non-positive interval', () => {
    expect(() => resamplePoints([{ lat: 51, lon: -2 }], 0)).toThrow(/interval/)
    expect(() => resamplePoints([{ lat: 51, lon: -2 }], -5)).toThrow(/interval/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './resample'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/resample.ts`:

```ts
import type { LatLon } from './types'
import { haversineMeters } from './geo'

/**
 * Re-space a polyline to a fixed interval by linear interpolation. Raw OSM
 * geometry has ~7m median spacing; summing |Δelevation| at that density
 * against a ~90m DEM manufactures gradient noise, so elevation sampling
 * happens on resampled geometry. The final point is always kept.
 */
export function resamplePoints(points: LatLon[], intervalMeters: number): LatLon[] {
  if (!Number.isFinite(intervalMeters) || intervalMeters <= 0) {
    throw new Error('intervalMeters must be a positive number')
  }
  if (points.length < 2) return [...points]

  const result: LatLon[] = [points[0]]
  let sinceLast = 0
  for (let i = 1; i < points.length; i++) {
    let from = points[i - 1]
    const to = points[i]
    let remaining = haversineMeters(from, to)
    while (sinceLast + remaining >= intervalMeters) {
      const needed = intervalMeters - sinceLast
      const t = needed / remaining
      const next = {
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
      }
      result.push(next)
      from = next
      remaining -= needed
      sinceLast = 0
    }
    sinceLast += remaining
  }
  const last = points[points.length - 1]
  const tail = result[result.length - 1]
  if (tail.lat !== last.lat || tail.lon !== last.lon) result.push(last)
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: polyline resampling for stable elevation sampling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Chain evaluation and scoring

**Files:**
- Create: `src/lib/engine/evaluate.ts`
- Test: `src/lib/engine/evaluate.test.ts`

**Interfaces:**
- Consumes: `Chain` from `./types`; **type-only** `TerrainRequirements` from `@/lib/domain/types`.
- Produces: `ChainEvaluation`, `evaluateChain(chain: Chain, requirements: TerrainRequirements, gradientPercent: number | null): ChainEvaluation`, `chainMinQuietness(chain: Chain): number`. Task 4 calls `evaluateChain` twice: gradient = null for the cheap prefilter, then with the real gradient.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TerrainRequirements } from '@/lib/domain/types'
import { chainMinQuietness, evaluateChain } from './evaluate'
import type { Chain, RunEdge, SurfaceKind } from './types'

function edge(lengthMeters: number, quietness: number, surface: SurfaceKind): RunEdge {
  return {
    wayId: 1,
    fromNodeId: 1,
    toNodeId: 2,
    points: [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.46, lon: -2.58 },
    ],
    lengthMeters,
    highway: 'residential',
    quietness,
    surface,
  }
}

function chain(edges: RunEdge[]): Chain {
  return {
    edges,
    points: edges.flatMap((e) => e.points),
    lengthMeters: edges.reduce((s, e) => s + e.lengthMeters, 0),
    startNodeId: 1,
    endNodeId: 2,
    isCycle: false,
  }
}

const intervals: TerrainRequirements = {
  maxAvgGradientPercent: 1,
  minAvgGradientPercent: null,
  maxJunctionsPerKm: 1,
  minQuietness: 0.7,
  surface: 'paved',
  minUninterruptedMeters: 800,
}

const hills: TerrainRequirements = {
  maxAvgGradientPercent: 15,
  minAvgGradientPercent: 4,
  maxJunctionsPerKm: 2,
  minQuietness: 0.5,
  surface: 'any',
  minUninterruptedMeters: 300,
}

describe('chainMinQuietness', () => {
  it('is the minimum over edges', () => {
    expect(chainMinQuietness(chain([edge(100, 0.9, 'paved'), edge(100, 0.6, 'paved')]))).toBe(0.6)
  })
})

describe('evaluateChain — static checks (gradient null)', () => {
  it('passes a long quiet paved chain', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails a chain shorter than minUninterruptedMeters', () => {
    const result = evaluateChain(chain([edge(500, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/800/)
  })

  it('fails when any edge is louder than minQuietness', () => {
    const result = evaluateChain(chain([edge(600, 0.9, 'paved'), edge(600, 0.45, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/quietness/i)
  })

  it('fails closed: unknown surface does not satisfy a paved requirement', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'unknown')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/paved/i)
  })

  it('surface any accepts unpaved and unknown', () => {
    const result = evaluateChain(chain([edge(500, 0.9, 'unknown')]), hills, null)
    expect(result.passes).toBe(true)
  })
})

describe('evaluateChain — gradient checks', () => {
  it('fails intervals on a 3% gradient', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 3)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/gradient/i)
  })

  it('passes intervals on flat ground', () => {
    expect(evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.3).passes).toBe(true)
  })

  it('hills require climb: flat fails, steep passes', () => {
    const flat = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 0.5)
    expect(flat.passes).toBe(false)
    const steep = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 8)
    expect(steep.passes).toBe(true)
  })
})

describe('scoring', () => {
  it('prefers quieter chains, all else equal', () => {
    const quiet = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.3)
    const louder = evaluateChain(chain([edge(1000, 0.7, 'paved')]), intervals, 0.3)
    expect(quiet.score).toBeGreaterThan(louder.score)
  })

  it('prefers flatter chains for flat sessions and steeper for hills', () => {
    const flat = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.2)
    const rolling = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.9)
    expect(flat.score).toBeGreaterThan(rolling.score)

    const steep = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 9)
    const gentle = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 5)
    expect(steep.score).toBeGreaterThan(gentle.score)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './evaluate'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/evaluate.ts`:

```ts
import type { TerrainRequirements } from '@/lib/domain/types'
import type { Chain } from './types'

export interface ChainEvaluation {
  passes: boolean
  failures: string[]
  minQuietness: number
  score: number
}

export function chainMinQuietness(chain: Chain): number {
  return chain.edges.reduce((min, e) => Math.min(min, e.quietness), 1)
}

/**
 * Check a chain against a work phase's terrain requirements and score it
 * for ranking. Pass gradientPercent = null to run only the static checks
 * (length, quietness, surface) — the finder uses that as a cheap prefilter
 * before spending elevation lookups.
 *
 * maxJunctionsPerKm needs no check here: chains have no interior true
 * crossings by construction (see buildChains).
 *
 * The score is a v1 ranking heuristic, not a calibrated quantity:
 * quietness dominates, then gradient fit (flatness — or steepness when the
 * session wants climb), then a capped bonus for longer stretches.
 */
export function evaluateChain(
  chain: Chain,
  requirements: TerrainRequirements,
  gradientPercent: number | null,
): ChainEvaluation {
  const failures: string[] = []
  const minQuietness = chainMinQuietness(chain)

  if (
    requirements.minUninterruptedMeters !== null &&
    chain.lengthMeters < requirements.minUninterruptedMeters
  ) {
    failures.push(
      `stretch is ${Math.round(chain.lengthMeters)}m, shorter than the required ${requirements.minUninterruptedMeters}m`,
    )
  }
  if (minQuietness < requirements.minQuietness) {
    failures.push(`quietness ${minQuietness} is below the required ${requirements.minQuietness}`)
  }
  if (requirements.surface === 'paved' && !chain.edges.every((e) => e.surface === 'paved')) {
    failures.push('surface is not verifiably paved throughout (unknown fails closed)')
  }
  if (gradientPercent !== null) {
    if (gradientPercent > requirements.maxAvgGradientPercent) {
      failures.push(
        `gradient ${gradientPercent.toFixed(1)}% exceeds the maximum ${requirements.maxAvgGradientPercent}%`,
      )
    }
    if (
      requirements.minAvgGradientPercent !== null &&
      gradientPercent < requirements.minAvgGradientPercent
    ) {
      failures.push(
        `gradient ${gradientPercent.toFixed(1)}% is below the required ${requirements.minAvgGradientPercent}%`,
      )
    }
  }

  const wantsClimb = requirements.minAvgGradientPercent !== null
  let score = minQuietness * 2 + Math.min(chain.lengthMeters / 1000, 2) * 0.25
  if (gradientPercent !== null) {
    score += wantsClimb
      ? Math.min(gradientPercent / 10, 1)
      : Math.max(0, 1 - gradientPercent / 5)
  }

  return { passes: failures.length === 0, failures, minQuietness, score }
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: chain evaluation against terrain requirements with ranking score

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The finder

**Files:**
- Create: `src/lib/engine/finder.ts`
- Test: `src/lib/engine/finder.test.ts`

**Interfaces:**
- Consumes: `buildChains` from `./chains`; `resamplePoints` from `./resample`; `evaluateChain` from `./evaluate`; `haversineMeters`, `cumulativeMeters` from `./geo`; `avgAbsGradientPercent` from `./elevation`; `RunGraph`, `LatLon`, `Chain` from `./types`; type-only `TerrainRequirements` from `@/lib/domain/types`.
- Produces: `ElevationSampler`, `FindOptions`, `WorkSegment`, `findWorkSegments(graph, start, requirements, sampleElevations, options?): Promise<WorkSegment[]>`. Plan C consumes `WorkSegment` (routes connectors to its endpoints, builds laps, assembles GPX); production callers pass `fetchElevations` as the sampler.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/finder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TerrainRequirements } from '@/lib/domain/types'
import { buildGraph } from './graph'
import { findWorkSegments, type ElevationSampler } from './finder'
import type { LatLon, OsmWay } from './types'

/** A straight way heading north; step 0.001 lat ≈ 111m per hop. */
function straightWay(
  id: number,
  startLat: number,
  lon: number,
  nodeCount: number,
  highway: string,
  surface?: string,
): OsmWay {
  const tags: Record<string, string> = { highway }
  if (surface) tags.surface = surface
  return {
    id,
    tags,
    nodeIds: Array.from({ length: nodeCount }, (_, i) => id * 1000 + i),
    points: Array.from({ length: nodeCount }, (_, i) => ({
      lat: startLat + i * 0.001,
      lon,
    })),
  }
}

const start: LatLon = { lat: 51.45, lon: -2.58 }

const intervals: TerrainRequirements = {
  maxAvgGradientPercent: 1,
  minAvgGradientPercent: null,
  maxJunctionsPerKm: 1,
  minQuietness: 0.7,
  surface: 'paved',
  minUninterruptedMeters: 800,
}

const hills: TerrainRequirements = {
  maxAvgGradientPercent: 15,
  minAvgGradientPercent: 4,
  maxJunctionsPerKm: 2,
  minQuietness: 0.5,
  surface: 'any',
  minUninterruptedMeters: 300,
}

const flatSampler: ElevationSampler = async (points) => points.map(() => 10)
/** Rises 4m per resampled point; at 40m spacing that is a ~10% gradient. */
const steepSampler: ElevationSampler = async (points) => points.map((_, i) => i * 4)

describe('findWorkSegments', () => {
  it('finds a quiet kilometre of residential street for intervals', async () => {
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'), // ~1000m, quiet, paved
      straightWay(2, 51.45, -2.577, 10, 'trunk', 'asphalt'), // ~1000m but loud
    ])
    const results = await findWorkSegments(graph, start, intervals, flatSampler)
    expect(results).toHaveLength(1)
    expect(results[0].lengthMeters).toBeGreaterThan(800)
    expect(results[0].minQuietness).toBe(0.7)
    expect(results[0].avgAbsGradientPercent).toBe(0)
  })

  it('does not spend elevation calls on chains that fail static checks', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'), // qualifies
      straightWay(2, 51.45, -2.577, 3, 'residential', 'asphalt'), // ~222m: too short
      straightWay(3, 51.45, -2.575, 10, 'trunk', 'asphalt'), // too loud
    ])
    await findWorkSegments(graph, start, intervals, recording)
    expect(calls).toHaveLength(1)
  })

  it('excludes chains beyond maxDistanceFromStartMeters without sampling them', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([straightWay(1, 52.45, -2.58, 10, 'residential', 'asphalt')]) // ~111km away
    const results = await findWorkSegments(graph, start, intervals, recording, {
      maxDistanceFromStartMeters: 2000,
    })
    expect(results).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('rejects flat ground for hills and accepts a climb', async () => {
    const graph = buildGraph([straightWay(1, 51.45, -2.58, 5, 'path')]) // ~444m, unpaved ok for hills
    const flat = await findWorkSegments(graph, start, hills, flatSampler)
    expect(flat).toHaveLength(0)
    const steep = await findWorkSegments(graph, start, hills, steepSampler)
    expect(steep).toHaveLength(1)
    expect(steep[0].avgAbsGradientPercent).toBeGreaterThan(4)
  })

  it('ranks quieter stretches first', async () => {
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'), // 0.7
      straightWay(2, 51.45, -2.577, 10, 'cycleway', 'asphalt'), // 0.9
    ])
    const results = await findWorkSegments(graph, start, intervals, flatSampler)
    expect(results).toHaveLength(2)
    expect(results[0].minQuietness).toBe(0.9)
    expect(results[1].minQuietness).toBe(0.7)
  })

  it('caps results at maxResults', async () => {
    const ways = Array.from({ length: 4 }, (_, i) =>
      straightWay(i + 1, 51.45, -2.58 - i * 0.003, 10, 'residential', 'asphalt'),
    )
    const results = await findWorkSegments(buildGraph(ways), start, intervals, flatSampler, {
      maxResults: 2,
    })
    expect(results).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './finder'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/finder.ts`:

```ts
import type { TerrainRequirements } from '@/lib/domain/types'
import type { Chain, LatLon, RunGraph } from './types'
import { buildChains } from './chains'
import { evaluateChain } from './evaluate'
import { avgAbsGradientPercent } from './elevation'
import { cumulativeMeters, haversineMeters } from './geo'
import { resamplePoints } from './resample'

export type ElevationSampler = (points: LatLon[]) => Promise<number[]>

export interface FindOptions {
  /** Straight-line prefilter radius from the start point. Default 2000. */
  maxDistanceFromStartMeters?: number
  maxResults?: number
  /** Spacing for elevation sampling. Default 40. */
  resampleIntervalMeters?: number
}

export interface WorkSegment {
  points: LatLon[]
  lengthMeters: number
  distanceFromStartMeters: number
  isCycle: boolean
  minQuietness: number
  avgAbsGradientPercent: number
  score: number
}

function distanceFromStart(start: LatLon, chain: Chain): number {
  let min = Infinity
  for (const point of chain.points) {
    const d = haversineMeters(start, point)
    if (d < min) min = d
  }
  return min
}

/**
 * Find ranked work segments near a start point. Cheap checks run first —
 * distance prefilter, then static requirement checks (gradient = null) —
 * so the elevation sampler is only called for chains that could actually
 * qualify. Whole-chain evaluation only: finding a qualifying sub-window
 * inside a longer chain that fails on average is a future refinement.
 */
export async function findWorkSegments(
  graph: RunGraph,
  start: LatLon,
  requirements: TerrainRequirements,
  sampleElevations: ElevationSampler,
  options: FindOptions = {},
): Promise<WorkSegment[]> {
  const {
    maxDistanceFromStartMeters = 2000,
    maxResults = 5,
    resampleIntervalMeters = 40,
  } = options

  const candidates: Array<{ chain: Chain; distance: number }> = []
  for (const chain of buildChains(graph)) {
    const distance = distanceFromStart(start, chain)
    if (distance > maxDistanceFromStartMeters) continue
    if (!evaluateChain(chain, requirements, null).passes) continue
    candidates.push({ chain, distance })
  }

  const results: WorkSegment[] = []
  for (const { chain, distance } of candidates) {
    const resampled = resamplePoints(chain.points, resampleIntervalMeters)
    const elevations = await sampleElevations(resampled)
    const gradient = avgAbsGradientPercent(elevations, cumulativeMeters(resampled))
    const evaluation = evaluateChain(chain, requirements, gradient)
    if (!evaluation.passes) continue
    results.push({
      points: chain.points,
      lengthMeters: chain.lengthMeters,
      distanceFromStartMeters: distance,
      isCycle: chain.isCycle,
      minQuietness: evaluation.minQuietness,
      avgAbsGradientPercent: gradient,
      score: evaluation.score,
    })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults)
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: work-segment finder with prefiltered elevation sampling and ranking

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
