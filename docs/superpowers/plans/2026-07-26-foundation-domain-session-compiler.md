# Foundation: Scaffold + Domain Model + Session Compiler — Implementation Plan

**Status:** complete (landed 2026-07-26) · **Owner:** Liam

> Step checkboxes below were never ticked during execution, but the work
> shipped — `src/lib/domain/` and its tests are on `main`. Trust `git log` and
> the code, not the boxes. On future plans, tick as you land each step and
> update this header when you claim or finish a plan (see `AGENTS.md`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the route-planner Next.js project and implement the fully-tested domain core that compiles a runner's session (e.g. "6×800m intervals") into a phased plan with terrain requirements.

**Architecture:** Next.js App Router app scaffolded with TypeScript + Tailwind. The domain core is pure TypeScript under `src/lib/domain/` with zero framework or I/O dependencies — a `Session` (discriminated union of the five preset types) compiles via `compileSession()` into a `SessionPlan` of phases (warmup → work → cooldown), where the work phase carries `TerrainRequirements` derived from the session's structure (rep length ⇒ minimum uninterrupted stretch, hills ⇒ minimum gradient). Later plans (route engine, UI, accounts) consume this module unchanged.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind, src dir), Vitest for unit tests, npm.

## Global Constraints

- This is a greenfield directory: NOT yet a git repo — Task 1 runs `git init`.
- Node 20+; npm as package manager.
- All distances are **meters** internally; km appears only at UI boundaries (later plans).
- Domain vocabulary (use these exact names): `Session`, `SessionPlan`, `PhasePlan`, `PhaseKind` (`'warmup' | 'work' | 'cooldown'`), `TerrainRequirements`, `WorkPattern` (`'continuous' | 'laps'`).
- Quietness is a 0–1 score (1 = quietest). Gradients are percent.
- Product decisions of record live in the grilling decision log (see `docs/domain.md` created in Task 4): phases modeled from day one; GPX export not tracking; accounts hold saved routes + start points + feedback; imagery is a post-MVP pluggable signal (Mapillary, never scraped Street View).
- Build-time picks (already decided, do not re-litigate): elevation = Open-Meteo Elevation API; connector routing = Openrouteservice free tier. Neither is used in THIS plan — they are for the route-engine plan.
- Clerk/Neon are provisioned via Vercel Marketplace in a LATER plan — do not npm-install any auth/db SDK in this plan.
- No `any` types; `npm run lint` and `npm test` must pass at every commit.
- Commit messages: conventional commits ending with a `Co-Authored-By:` trailer naming the model that did the work — see `AGENTS.md`.

---

### Task 1: Scaffold the project

**Files:**
- Create: entire Next.js scaffold at repo root (`package.json`, `src/app/*`, `tsconfig.json`, …)
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a running Next.js app and a `npm test` command executing Vitest over `src/**/*.test.ts`. Path alias `@/*` → `src/*` works in both Next and Vitest.

- [ ] **Step 1: Init git and scaffold Next.js**

```bash
cd /Users/liamgrogan/Projects/route-planner
git init
npx create-next-app@latest . --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --turbopack --yes
```

If `create-next-app` refuses because the directory contains `.claude/` or `docs/`: move them aside (`mv .claude docs /tmp/rp-keep/`), re-run the scaffold command, then move them back (`mv /tmp/rp-keep/.claude /tmp/rp-keep/docs .`).

- [ ] **Step 2: Verify the app builds and lints**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 3: Install and configure Vitest**

```bash
npm install -D vitest
```

Create `vitest.config.ts`:

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
```

In `package.json`, add to `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 4: Prove the test runner works**

Create `src/lib/domain/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm test`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: scaffold Next.js app with Vitest

Co-Authored-By: Claude <your model> <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Domain types and terrain-requirement profiles

**Files:**
- Create: `src/lib/domain/types.ts`
- Create: `src/lib/domain/profiles.ts`
- Test: `src/lib/domain/profiles.test.ts`
- Delete: `src/lib/domain/smoke.test.ts` (superseded by real tests)

**Interfaces:**
- Consumes: nothing.
- Produces: all domain types listed below, and `terrainRequirementsFor(session: Session): TerrainRequirements`. Task 3 imports both. The route-engine plan consumes `TerrainRequirements` as its constraint input.

- [ ] **Step 1: Write the domain types**

Create `src/lib/domain/types.ts` (types only — no test needed until behavior exists):

```ts
export type RecoveryType = 'jog' | 'static'

export interface EasySession {
  type: 'easy'
  distanceMeters: number
}

export interface LongSession {
  type: 'long'
  distanceMeters: number
}

export interface TempoSession {
  type: 'tempo'
  tempoMeters: number
}

export interface IntervalsSession {
  type: 'intervals'
  reps: number
  repMeters: number
  recovery: RecoveryType
}

export interface HillsSession {
  type: 'hills'
  reps: number
  hillMeters: number
}

export type Session =
  | EasySession
  | LongSession
  | TempoSession
  | IntervalsSession
  | HillsSession

export type SurfaceClass = 'paved' | 'any'

export interface TerrainRequirements {
  /** Mean |gradient| ceiling along the work segment, in percent. */
  maxAvgGradientPercent: number
  /** Hills sessions demand climb; null for every other type. */
  minAvgGradientPercent: number | null
  maxJunctionsPerKm: number
  /** 0–1, 1 = quietest. Road-class proxy until imagery/feedback signals exist. */
  minQuietness: number
  surface: SurfaceClass
  /** Longest stretch the runner must cover without a forced stop; null = no requirement. */
  minUninterruptedMeters: number | null
}

export type PhaseKind = 'warmup' | 'work' | 'cooldown'

export interface PhasePlan {
  kind: PhaseKind
  targetMeters: number
  /** null = relaxed (any runnable terrain) — used for connectors. */
  requirements: TerrainRequirements | null
}

export type WorkPattern = 'continuous' | 'laps'

export interface SessionPlan {
  session: Session
  phases: PhasePlan[]
  workPattern: WorkPattern
  totalMeters: number
}

export interface CompilerConfig {
  /** Override the warmup/cooldown connector length (meters each way). */
  connectorMeters?: number
}
```

- [ ] **Step 2: Write failing tests for the profile table**

Create `src/lib/domain/profiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { terrainRequirementsFor } from './profiles'

describe('terrainRequirementsFor', () => {
  it('intervals demand flat, paved, quiet ground with an uninterrupted stretch of one rep', () => {
    const req = terrainRequirementsFor({
      type: 'intervals',
      reps: 6,
      repMeters: 800,
      recovery: 'jog',
    })
    expect(req.minUninterruptedMeters).toBe(800)
    expect(req.surface).toBe('paved')
    expect(req.maxAvgGradientPercent).toBeLessThanOrEqual(1)
    expect(req.minQuietness).toBeGreaterThanOrEqual(0.7)
    expect(req.minAvgGradientPercent).toBeNull()
  })

  it('hills are the one session type that demands gradient', () => {
    const req = terrainRequirementsFor({ type: 'hills', reps: 8, hillMeters: 300 })
    expect(req.minAvgGradientPercent).not.toBeNull()
    expect(req.minAvgGradientPercent!).toBeGreaterThanOrEqual(4)
    expect(req.minUninterruptedMeters).toBe(300)
  })

  it('tempo wants continuity via junction density, not a literal uninterrupted stretch', () => {
    const req = terrainRequirementsFor({ type: 'tempo', tempoMeters: 5000 })
    expect(req.minUninterruptedMeters).toBeNull()
    expect(req.maxJunctionsPerKm).toBeLessThanOrEqual(2)
    expect(req.surface).toBe('paved')
  })

  it('easy runs are the most permissive profile', () => {
    const easy = terrainRequirementsFor({ type: 'easy', distanceMeters: 8000 })
    const tempo = terrainRequirementsFor({ type: 'tempo', tempoMeters: 5000 })
    expect(easy.surface).toBe('any')
    expect(easy.maxJunctionsPerKm).toBeGreaterThan(tempo.maxJunctionsPerKm)
    expect(easy.minQuietness).toBeLessThan(tempo.minQuietness)
  })

  it('long runs allow any surface but prefer more quiet than easy runs', () => {
    const long = terrainRequirementsFor({ type: 'long', distanceMeters: 20000 })
    const easy = terrainRequirementsFor({ type: 'easy', distanceMeters: 8000 })
    expect(long.surface).toBe('any')
    expect(long.minQuietness).toBeGreaterThan(easy.minQuietness)
    expect(long.minUninterruptedMeters).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './profiles'` (or equivalent).

- [ ] **Step 4: Implement the profile table**

Create `src/lib/domain/profiles.ts`:

```ts
import type { Session, TerrainRequirements } from './types'

/**
 * Terrain-requirement profile per session type. Values are the product
 * decisions from the 2026-07-26 grilling session: intervals want flat,
 * smooth, quiet, uninterrupted; hills invert the gradient requirement;
 * easy/long relax everything.
 */
export function terrainRequirementsFor(session: Session): TerrainRequirements {
  switch (session.type) {
    case 'easy':
      return {
        maxAvgGradientPercent: 6,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 8,
        minQuietness: 0.4,
        surface: 'any',
        minUninterruptedMeters: null,
      }
    case 'long':
      return {
        maxAvgGradientPercent: 5,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 5,
        minQuietness: 0.5,
        surface: 'any',
        minUninterruptedMeters: null,
      }
    case 'tempo':
      return {
        maxAvgGradientPercent: 2,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 2,
        minQuietness: 0.6,
        surface: 'paved',
        minUninterruptedMeters: null,
      }
    case 'intervals':
      return {
        maxAvgGradientPercent: 1,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 1,
        minQuietness: 0.7,
        surface: 'paved',
        minUninterruptedMeters: session.repMeters,
      }
    case 'hills':
      return {
        maxAvgGradientPercent: 15,
        minAvgGradientPercent: 4,
        maxJunctionsPerKm: 2,
        minQuietness: 0.5,
        surface: 'any',
        minUninterruptedMeters: session.hillMeters,
      }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass; delete the smoke test**

Run: `npm test`
Expected: all profile tests PASS.

```bash
rm src/lib/domain/smoke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: domain types and terrain-requirement profiles

Co-Authored-By: Claude <your model> <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Session compiler

**Files:**
- Create: `src/lib/domain/compiler.ts`
- Test: `src/lib/domain/compiler.test.ts`

**Interfaces:**
- Consumes: `Session`, `SessionPlan`, `PhasePlan`, `CompilerConfig` from `./types`; `terrainRequirementsFor` from `./profiles`.
- Produces: `compileSession(session: Session, config?: CompilerConfig): SessionPlan`, `workMetersFor(session: Session): number`, `defaultConnectorMeters(workMeters: number): number`. The route-engine plan calls `compileSession` and routes each `PhasePlan`; the UI plan displays `SessionPlan` totals.

- [ ] **Step 1: Write failing tests**

Create `src/lib/domain/compiler.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compileSession, defaultConnectorMeters, workMetersFor } from './compiler'

describe('workMetersFor', () => {
  it('sums reps plus half-rep jog recoveries between them', () => {
    // 6 × 800m + 5 jog recoveries of 400m = 4800 + 2000
    expect(
      workMetersFor({ type: 'intervals', reps: 6, repMeters: 800, recovery: 'jog' }),
    ).toBe(6800)
  })

  it('static recovery adds no distance', () => {
    expect(
      workMetersFor({ type: 'intervals', reps: 12, repMeters: 400, recovery: 'static' }),
    ).toBe(4800)
  })

  it('hill reps count the jog back down', () => {
    // 8 × 300m up + 8 × 300m back down
    expect(workMetersFor({ type: 'hills', reps: 8, hillMeters: 300 })).toBe(4800)
  })
})

describe('defaultConnectorMeters', () => {
  it('is 15% of work distance within a 1–2km clamp', () => {
    expect(defaultConnectorMeters(10000)).toBe(1500)
    expect(defaultConnectorMeters(2000)).toBe(1000) // floor
    expect(defaultConnectorMeters(40000)).toBe(2000) // ceiling
  })
})

describe('compileSession', () => {
  it('compiles an easy run to a single continuous phase with no connectors', () => {
    const plan = compileSession({ type: 'easy', distanceMeters: 8000 })
    expect(plan.phases).toHaveLength(1)
    expect(plan.phases[0].kind).toBe('work')
    expect(plan.phases[0].targetMeters).toBe(8000)
    expect(plan.phases[0].requirements).not.toBeNull()
    expect(plan.workPattern).toBe('continuous')
    expect(plan.totalMeters).toBe(8000)
  })

  it('compiles long runs the same single-phase way', () => {
    const plan = compileSession({ type: 'long', distanceMeters: 20000 })
    expect(plan.phases).toHaveLength(1)
    expect(plan.totalMeters).toBe(20000)
  })

  it('compiles intervals to warmup → work → cooldown with relaxed connectors', () => {
    const plan = compileSession({
      type: 'intervals',
      reps: 6,
      repMeters: 800,
      recovery: 'jog',
    })
    expect(plan.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
    expect(plan.phases[0].requirements).toBeNull()
    expect(plan.phases[2].requirements).toBeNull()
    expect(plan.phases[1].targetMeters).toBe(6800)
    expect(plan.phases[1].requirements?.minUninterruptedMeters).toBe(800)
    expect(plan.workPattern).toBe('laps')
    // connector = clamp(6800 * 0.15) = 1020 each way
    expect(plan.totalMeters).toBe(6800 + 2 * 1020)
  })

  it('honors an explicit connector override', () => {
    const plan = compileSession(
      { type: 'intervals', reps: 6, repMeters: 800, recovery: 'jog' },
      { connectorMeters: 2500 },
    )
    expect(plan.phases[0].targetMeters).toBe(2500)
    expect(plan.totalMeters).toBe(6800 + 5000)
  })

  it('tempo is continuous, not laps', () => {
    const plan = compileSession({ type: 'tempo', tempoMeters: 5000 })
    expect(plan.workPattern).toBe('continuous')
    expect(plan.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
  })

  it('hills run as laps of the hill', () => {
    const plan = compileSession({ type: 'hills', reps: 8, hillMeters: 300 })
    expect(plan.workPattern).toBe('laps')
    expect(plan.phases[1].requirements?.minAvgGradientPercent).toBe(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './compiler'`.

- [ ] **Step 3: Implement the compiler**

Create `src/lib/domain/compiler.ts`:

```ts
import type { CompilerConfig, PhasePlan, Session, SessionPlan } from './types'
import { terrainRequirementsFor } from './profiles'

/** Jog recoveries between reps default to half the rep distance. */
const JOG_RECOVERY_FACTOR = 0.5

/** Warmup/cooldown default to 15% of work distance, clamped to 1–2km each. */
const CONNECTOR_SHARE = 0.15
const CONNECTOR_MIN_METERS = 1000
const CONNECTOR_MAX_METERS = 2000

export function workMetersFor(session: Session): number {
  switch (session.type) {
    case 'easy':
    case 'long':
      return session.distanceMeters
    case 'tempo':
      return session.tempoMeters
    case 'intervals': {
      const reps = session.reps * session.repMeters
      const recoveries =
        session.recovery === 'jog'
          ? Math.round(JOG_RECOVERY_FACTOR * session.repMeters) * (session.reps - 1)
          : 0
      return reps + recoveries
    }
    case 'hills':
      return session.reps * session.hillMeters * 2
  }
}

export function defaultConnectorMeters(workMeters: number): number {
  return Math.min(
    CONNECTOR_MAX_METERS,
    Math.max(CONNECTOR_MIN_METERS, Math.round(workMeters * CONNECTOR_SHARE)),
  )
}

export function compileSession(
  session: Session,
  config: CompilerConfig = {},
): SessionPlan {
  const work = workMetersFor(session)
  const requirements = terrainRequirementsFor(session)

  if (session.type === 'easy' || session.type === 'long') {
    const phases: PhasePlan[] = [
      { kind: 'work', targetMeters: work, requirements },
    ]
    return { session, phases, workPattern: 'continuous', totalMeters: work }
  }

  const connector = config.connectorMeters ?? defaultConnectorMeters(work)
  const phases: PhasePlan[] = [
    { kind: 'warmup', targetMeters: connector, requirements: null },
    { kind: 'work', targetMeters: work, requirements },
    { kind: 'cooldown', targetMeters: connector, requirements: null },
  ]
  return {
    session,
    phases,
    workPattern: session.type === 'tempo' ? 'continuous' : 'laps',
    totalMeters: connector * 2 + work,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (profiles + compiler).

- [ ] **Step 5: Lint and commit**

Run: `npm run lint`
Expected: clean.

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: session compiler producing phased plans with terrain requirements

Co-Authored-By: Claude <your model> <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Domain documentation

**Files:**
- Create: `docs/domain.md`

**Interfaces:**
- Consumes: the vocabulary implemented in Tasks 2–3.
- Produces: the reference document later plans and future contributors read first.

- [ ] **Step 1: Write the domain doc**

Create `docs/domain.md` with exactly this content:

```markdown
# Route Planner — Domain Model

An app for runners that generates routes *from the planned session*, not the
other way round. The session drives the route: intervals want flat, smooth,
quiet, uninterrupted ground; hill reps want gradient; easy runs relax
everything.

## Ubiquitous language

| Term | Meaning |
|------|---------|
| **Session** | What the runner plans to do: one of `easy`, `long`, `tempo`, `intervals`, `hills`, each with a minimal type-specific form (no pace input). |
| **SessionPlan** | The compiled shape of a session: ordered phases + work pattern + computed total distance. Total distance is computed, never asked. |
| **Phase** | One leg of the run: `warmup` / `work` / `cooldown`. Connectors (warmup, cooldown) carry `requirements: null` = any runnable terrain. |
| **TerrainRequirements** | What the work phase demands of the ground: gradient bounds, junction density, quietness, surface, minimum uninterrupted stretch. Rep length *is* the uninterrupted-stretch requirement. |
| **WorkPattern** | `continuous` (easy/long/tempo) vs `laps` (intervals/hills repeat one segment). |
| **Quietness** | 0–1 score, 1 = quietest. Currently a road-class proxy from OSM; a pluggable *signal*, by design. |
| **Signal** | Any scored input to segment quality: OSM tags, elevation, later Mapillary imagery (offline, cached) and post-run user feedback. New signals must slot in without rewriting the scorer. |

## Decisions of record (2026-07-26 grilling session)

1. Session-aware route generation is the product; plotting is not.
2. Manual session entry for MVP; Garmin/Runna import deferred but kept compatible.
3. Planning tool, not tracking: map preview + GPX export to watches; no in-run navigation. Web app.
4. Phases modeled from day one; export is still one continuous GPX.
5. Routes are loops from the runner's door (geolocate + pin/postcode fallback); connectors default to ~15% of work distance, clamped 1–2km, tunable.
6. Engine is hybrid: our own work-segment finder (OSM + open elevation, scored graph) + hosted A→B routing for connectors (Openrouteservice). Elevation: Open-Meteo.
7. Street imagery is post-MVP, Mapillary only (never scraped Street View), computed offline and cached — hence pluggable signals.
8. Accounts ARE in the MVP and hold exactly three things: saved routes, saved start points, post-run route feedback (ground truth for segment quality). Clerk + Neon via Vercel Marketplace.
9. Built for Liam first (UK-first, free tiers), architected to scale into a shippable product.
```

- [ ] **Step 2: Commit**

```bash
git add docs/domain.md docs/superpowers
git commit -m "$(cat <<'EOF'
docs: domain model and decisions of record

Co-Authored-By: Claude <your model> <noreply@anthropic.com>
EOF
)"
```
