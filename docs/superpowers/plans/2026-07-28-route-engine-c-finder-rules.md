# Route Engine C: Finder Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two product rules Liam approved at Plan 2B close — minor joins don't cut an uninterrupted stretch (they count toward junction density instead), and tempo requires a real stretch floor — plus batched elevation sampling.

**Architecture:** Three changes to existing modules. `chains.ts` gets a smarter termination predicate: at a degree-≥3 node the chain continues when the same way (or, failing that, the same highway class) carries on through AND every other joining edge is a minor class (footway/path/cycleway/track/service); the node is then recorded on the chain as a *tolerated junction*. Crossing a major road still terminates — for the through-street AND for the footpath crossing it. `evaluate.ts` gains the junction-density check (tolerated junctions per km vs `maxJunctionsPerKm`), and the domain profiles are retuned because the number now counts minor joins, not road crossings. `finder.ts` batches all candidates' resampled points into ONE sampler call and slices results back per chain.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- Distances meters; gradients percent; quietness 0–1. No `any`; `npm run lint` and `npm test` pass at every commit.
- Product decisions of record (Liam, 2026-07-28 — do not re-litigate): (a) minor joins tolerated per the rule above; (b) tempo `minUninterruptedMeters = min(tempoMeters, 1500)`, run out-and-back.
- Retuned junction densities (the value's meaning changed from "road crossings" to "minor joins per km"): easy 12, long 10, tempo 6, intervals 6, hills 6.
- `Chain` gains `toleratedJunctionNodeIds: number[]` (JSON-safe array, NOT a Set). Every constructor of `Chain` — including test helpers in other test files — must be updated in the same task so the suite stays green.
- The `ElevationSampler` contract is unchanged; batching is internal to `findWorkSegments`.
- Existing tests may be updated ONLY where a step explicitly says so; never weaken an assertion without replacing it with a stronger or equally strong one.
- Commit messages: conventional commits ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Minor-join tolerance in the chain builder

**Files:**
- Modify: `src/lib/engine/types.ts` (`Chain` gains `toleratedJunctionNodeIds: number[]`)
- Modify: `src/lib/engine/chains.ts`
- Modify: `src/lib/engine/chains.test.ts` (new tests appended; existing tests untouched)
- Modify: `src/lib/engine/evaluate.test.ts` (ONLY the `chain()` helper: add `toleratedJunctionNodeIds: []` so it still compiles)

**Interfaces:**
- Produces: `MINOR_JOIN_HIGHWAYS: Set<string>` and the updated `buildChains` behavior. Task 2's density check reads `toleratedJunctionNodeIds`.

- [ ] **Step 1: Extend the Chain type**

In `src/lib/engine/types.ts`, add to the `Chain` interface (after `isCycle`):

```ts
  /** Degree->=3 nodes the chain was allowed to pass through because every
   *  other joining way is minor (footway/path/cycleway/track/service).
   *  These count toward junction density; true major crossings still
   *  terminate chains and never appear here. */
  toleratedJunctionNodeIds: number[]
```

And in `src/lib/engine/evaluate.test.ts`, update the `chain()` helper's return object to include `toleratedJunctionNodeIds: []`.

- [ ] **Step 2: Write failing tests**

Append to `src/lib/engine/chains.test.ts` (inside the existing `describe('buildChains', ...)`):

```ts
  it('continues a street through a footpath crossing, recording a tolerated junction', () => {
    // residential street 10-11-12 crossed at node 11 by footway 20-11-21
    const street = way(1, [10, 11, 12], [51.45, 51.451, 51.452])
    const path: OsmWay = {
      id: 2,
      tags: { highway: 'footway' },
      nodeIds: [20, 11, 21],
      points: [
        { lat: 51.451, lon: -2.579 },
        { lat: 51.451, lon: -2.5801 },
        { lat: 51.451, lon: -2.581 },
      ],
    }
    const chains = buildChains(buildGraph([street, path]))
    expect(chains).toHaveLength(3)
    const streetChain = chains.find((c) => c.edges[0].highway === 'residential')
    expect(streetChain).toBeDefined()
    expect(streetChain!.edges).toHaveLength(2)
    expect(streetChain!.toleratedJunctionNodeIds).toEqual([11])
    // the footway is still cut at the street: crossing a road IS a forced stop
    const footChains = chains.filter((c) => c.edges[0].highway === 'footway')
    expect(footChains).toHaveLength(2)
    for (const c of footChains) {
      expect(c.toleratedJunctionNodeIds).toEqual([])
    }
  })

  it('continues across a way-id change via same highway class when the join is minor', () => {
    const a = way(1, [10, 11], [51.45, 51.451])
    const b = way(2, [11, 12], [51.451, 51.452])
    const spur: OsmWay = {
      id: 3,
      tags: { highway: 'footway' },
      nodeIds: [11, 20],
      points: [
        { lat: 51.451, lon: -2.5801 },
        { lat: 51.451, lon: -2.579 },
      ],
    }
    const chains = buildChains(buildGraph([a, b, spur]))
    expect(chains).toHaveLength(2)
    const streetChain = chains.find((c) => c.edges[0].highway === 'residential')
    expect(streetChain!.edges).toHaveLength(2)
    expect(streetChain!.toleratedJunctionNodeIds).toEqual([11])
  })

  it('terminates on an ambiguous same-class fork', () => {
    const a: OsmWay = { id: 1, tags: { highway: 'footway' }, nodeIds: [10, 11], points: [{ lat: 51.45, lon: -2.58 }, { lat: 51.451, lon: -2.58 }] }
    const b: OsmWay = { id: 2, tags: { highway: 'footway' }, nodeIds: [11, 12], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.452, lon: -2.58 }] }
    const c: OsmWay = { id: 3, tags: { highway: 'footway' }, nodeIds: [11, 13], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.451, lon: -2.579 }] }
    const chains = buildChains(buildGraph([a, b, c]))
    expect(chains).toHaveLength(3)
    for (const ch of chains) {
      expect(ch.toleratedJunctionNodeIds).toEqual([])
    }
  })

  it('still terminates at a major crossing', () => {
    // the existing crossing test asserts 4 chains; this asserts none of them tolerated anything
    const graph = buildGraph([
      way(1, [10, 20, 12], [51.45, 51.451, 51.452]),
      way(2, [30, 20, 32], [51.46, 51.451, 51.462]),
    ])
    for (const chain of buildChains(graph)) {
      expect(chain.toleratedJunctionNodeIds).toEqual([])
    }
  })

  it('tolerance never shortens chains on the real Bristol fixture and strictly lengthens some', () => {
    const graph = buildGraph(parseOverpassResponse(fixture))
    const chains = buildChains(graph)
    const chainEdgeCount = chains.reduce((s, c) => s + c.edges.length, 0)
    expect(chainEdgeCount).toBe(graph.edges.length)
    const totalTolerated = chains.reduce((s, c) => s + c.toleratedJunctionNodeIds.length, 0)
    expect(totalTolerated).toBeGreaterThan(0)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — new tests fail (and possibly compile errors until types/helpers updated). Existing chain tests must still pass once the type change compiles.

- [ ] **Step 4: Implement**

Replace `src/lib/engine/chains.ts` with:

```ts
import type { Chain, RunEdge, RunGraph } from './types'

/** Highway classes whose joining at a node does not force a runner to stop. */
export const MINOR_JOIN_HIGHWAYS = new Set([
  'footway',
  'path',
  'cycleway',
  'track',
  'service',
])

function addIncident(adjacency: Map<number, RunEdge[]>, nodeId: number, edge: RunEdge): void {
  const list = adjacency.get(nodeId)
  if (list) list.push(edge)
  else adjacency.set(nodeId, [edge])
}

/**
 * Merge edges through degree-2 splice nodes into maximal chains, and —
 * per the minor-join rule — through degree->=3 nodes where the way (or its
 * highway class) continues and every other joining edge is minor. Such
 * nodes are recorded as tolerated junctions and count toward junction
 * density in evaluation. A true major crossing terminates the chain both
 * for the through-street and for a minor way crossing a major road:
 * crossing a road is a forced stop.
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

  /**
   * At a degree->=3 node, pick the continuation: the unique candidate on
   * the same way, else the unique candidate of the same highway class.
   * Continue only if every OTHER candidate is a minor join and the chosen
   * continuation is unvisited; otherwise terminate (return null).
   */
  const continuationThrough = (nodeId: number, arrived: RunEdge): RunEdge | null => {
    const candidates = (adjacency.get(nodeId) ?? []).filter((e) => e !== arrived)
    let chosen: RunEdge | null = null
    const byWay = candidates.filter((e) => e.wayId === arrived.wayId)
    if (byWay.length === 1) {
      chosen = byWay[0]
    } else if (byWay.length === 0) {
      const byClass = candidates.filter((e) => e.highway === arrived.highway)
      if (byClass.length === 1) chosen = byClass[0]
    }
    if (!chosen || visited.has(chosen)) return null
    const others = candidates.filter((e) => e !== chosen)
    if (!others.every((e) => MINOR_JOIN_HIGHWAYS.has(e.highway))) return null
    return chosen
  }

  const walk = (startNodeId: number, firstEdge: RunEdge): Chain => {
    const edges: RunEdge[] = []
    const points: Chain['points'] = []
    const toleratedJunctionNodeIds: number[] = []
    let nodeId = startNodeId
    let edge: RunEdge | undefined | null = firstEdge
    while (edge && !visited.has(edge)) {
      visited.add(edge)
      edges.push(edge)
      const forward = edge.fromNodeId === nodeId
      const oriented = forward ? edge.points : [...edge.points].reverse()
      if (points.length === 0) points.push(...oriented)
      else points.push(...oriented.slice(1))
      nodeId = forward ? edge.toNodeId : edge.fromNodeId
      if (nodeId === startNodeId) break // closed back on the start: cycle complete
      if (degree(nodeId) === 2) {
        edge = (adjacency.get(nodeId) ?? []).find((e) => !visited.has(e))
      } else {
        const next = continuationThrough(nodeId, edge)
        if (next) {
          toleratedJunctionNodeIds.push(nodeId)
          edge = next
        } else {
          break
        }
      }
    }
    return {
      edges,
      points,
      lengthMeters: edges.reduce((sum, e) => sum + e.lengthMeters, 0),
      startNodeId,
      endNodeId: nodeId,
      isCycle: nodeId === startNodeId && edges.length > 0,
      toleratedJunctionNodeIds,
    }
  }

  // Pass 1: start every chain from a node the walk cannot pass through.
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
Expected: all pass (existing + new), lint clean. NOTE: one pre-existing behavior deliberately changes — chains can now be longer on the fixture; the existing fixture test asserts edge-count conservation, which must still hold.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: chains tolerate minor joins, recording them as junctions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Tempo floor, retuned densities, and the junction-density check

**Files:**
- Modify: `src/lib/domain/profiles.ts`
- Modify: `src/lib/domain/profiles.test.ts` (tempo + junction assertions only)
- Modify: `src/lib/engine/evaluate.ts` (add density check)
- Modify: `src/lib/engine/evaluate.test.ts` (new density tests; update the two requirement literals' junction values)
- Modify: `docs/domain.md` (append decision 11)

**Interfaces:**
- `terrainRequirementsFor` semantics change: tempo gains a floor; `maxJunctionsPerKm` now means tolerated minor joins per km. `evaluateChain` enforces it in the static phase.

- [ ] **Step 1: Write failing tests**

In `src/lib/domain/profiles.test.ts`, replace the tempo test with:

```ts
  it('tempo requires an uninterrupted stretch of the tempo distance capped at 1.5km', () => {
    const long = terrainRequirementsFor({ type: 'tempo', tempoMeters: 5000 })
    expect(long.minUninterruptedMeters).toBe(1500)
    const short = terrainRequirementsFor({ type: 'tempo', tempoMeters: 1000 })
    expect(short.minUninterruptedMeters).toBe(1000)
    expect(long.surface).toBe('paved')
  })
```

and update the easy-vs-tempo relational test's expectations only if it asserts exact junction numbers (it asserts a `>` relation — 12 > 6 still holds, leave it).

In `src/lib/engine/evaluate.test.ts`: set `maxJunctionsPerKm: 6` in BOTH the `intervals` and `hills` requirement literals, and append:

```ts
describe('junction density', () => {
  it('fails a chain with too many tolerated junctions per km', () => {
    const c = chain([edge(1000, 0.9, 'paved')])
    c.toleratedJunctionNodeIds = [1, 2, 3, 4, 5, 6, 7]
    const result = evaluateChain(c, intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/junction/i)
  })

  it('passes a chain with acceptable tolerated-junction density', () => {
    const c = chain([edge(1000, 0.9, 'paved')])
    c.toleratedJunctionNodeIds = [1, 2, 3]
    expect(evaluateChain(c, intervals, null).passes).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: tempo test fails (still null), density tests fail (no check yet).

- [ ] **Step 3: Implement**

In `src/lib/domain/profiles.ts`:
- tempo case: `minUninterruptedMeters: Math.min(session.tempoMeters, 1500)` and `maxJunctionsPerKm: 6`.
- easy: `maxJunctionsPerKm: 12`; long: `10`; intervals: `6`; hills: `6`.
- Update the doc comment to note the junction number counts tolerated minor joins per km (see engine chains), not road crossings.

In `src/lib/engine/evaluate.ts`, add to the static section of `evaluateChain` (after the surface check), replacing the old "needs no check here" comment with:

```ts
  // Chains never contain interior MAJOR crossings (buildChains terminates
  // there); maxJunctionsPerKm bounds the tolerated minor joins per km.
  const junctionsPerKm =
    chain.toleratedJunctionNodeIds.length / (chain.lengthMeters / 1000)
  if (junctionsPerKm > requirements.maxJunctionsPerKm) {
    failures.push(
      `junction density ${junctionsPerKm.toFixed(1)}/km exceeds the maximum ${requirements.maxJunctionsPerKm}/km`,
    )
  }
```

Append to `docs/domain.md`'s decisions list:

```markdown
11. Minor-join tolerance (2026-07-28): a degree->=3 node whose other joining ways are all minor (footway/path/cycleway/track/service) does not cut an uninterrupted stretch; it counts toward `maxJunctionsPerKm`, whose meaning is now "tolerated minor joins per km" (retuned: easy 12, long 10, tempo/intervals/hills 6). Crossing a major road still terminates — in both directions. Tempo requires `min(tempoMeters, 1500)` of uninterrupted stretch, run out-and-back.
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain src/lib/engine docs/domain.md
git commit -m "$(cat <<'EOF'
feat: tempo stretch floor and tolerated-junction density check

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Batched elevation sampling

**Files:**
- Modify: `src/lib/engine/finder.ts`
- Modify: `src/lib/engine/finder.test.ts` (batching assertions; update requirement literals' junction values to 6)

**Interfaces:**
- `findWorkSegments` signature and `ElevationSampler` contract unchanged. Internally: one sampler call for ALL candidates' concatenated resampled points, sliced back per candidate.

- [ ] **Step 1: Write failing tests**

In `src/lib/engine/finder.test.ts`: set `maxJunctionsPerKm: 6` in both requirement literals, then append:

```ts
  it('batches all candidates into a single sampler call', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'),
      straightWay(2, 51.45, -2.577, 10, 'cycleway', 'asphalt'),
    ])
    const results = await findWorkSegments(graph, start, intervals, recording)
    expect(results).toHaveLength(2)
    expect(calls).toHaveLength(1)
    // the one call carries both candidates' resampled points
    expect(calls[0].length).toBeGreaterThan(40)
  })

  it('makes no sampler call when no candidate survives the prefilter', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([straightWay(1, 51.45, -2.58, 3, 'residential', 'asphalt')])
    const results = await findWorkSegments(graph, start, intervals, recording)
    expect(results).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the batching test fails (currently one call per candidate → 2 calls).

- [ ] **Step 3: Implement**

In `src/lib/engine/finder.ts`, replace the second loop (per-candidate sampling) with:

```ts
  const results: WorkSegment[] = []
  if (candidates.length > 0) {
    const resampledAll = candidates.map(({ chain }) =>
      resamplePoints(chain.points, resampleIntervalMeters),
    )
    // One batched call for every candidate; fetchElevations chunks by 100
    // internally, so this is at most a couple of HTTP requests total.
    const elevations = await sampleElevations(resampledAll.flat())
    let offset = 0
    for (let i = 0; i < candidates.length; i++) {
      const { chain, distance } = candidates[i]
      const resampled = resampledAll[i]
      const slice = elevations.slice(offset, offset + resampled.length)
      offset += resampled.length
      const gradient = avgAbsGradientPercent(slice, cumulativeMeters(resampled))
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
  }
```

Update the `findWorkSegments` doc comment's frugality sentence to mention the single batched call.

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint`
Expected: all pass — including the pre-existing steep-sampler hills test, whose per-index fake now spans the concatenation (deltas within a slice are unchanged, so gradients are identical).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
perf: batch elevation sampling across finder candidates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
