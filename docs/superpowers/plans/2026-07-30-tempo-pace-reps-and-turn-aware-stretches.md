# Tempo Pace + Reps, and Turn-Aware Work Stretches — Implementation Plan

**Status:** in progress · **Owner:** stuurps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`).

**Goal:** Make tempo (and the other structured sessions) match the Runna/Coopah
input model, and stop the finder failing on realistic ground. Two threads:

1. **Session inputs.** Structured sessions carry a **target pace**; **tempo**
   grows **reps + recovery** like intervals (decisions 13, 14).
2. **Turn-aware stretches.** A work stretch may **turn** to avoid crossing
   roads (left > right > straight-cross), and when a crossing-free stretch of
   the required length isn't reachable the finder returns a **best-effort
   stretch annotated with its crossings** instead of nothing (decision 15).

**Architecture:** Thread 1 is confined to `domain` + `session-input` + `results`
+ `export` — pace is workout metadata and never reaches the engine, so the
layering (AGENTS.md) is preserved: no engine module learns about pace. Thread 2
is an engine change in `chains.ts`/`finder.ts` plus a graceful-degradation
change in `plan.ts`/`results`; it does **not** touch `domain`. The two threads
are independent and ship as separate PR slices.

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test` green at **every** commit. No
  `any`; no disabled rules without an inline reason.
- Units (AGENTS.md): distances meters, gradients percent, **pace seconds/km**,
  scores 0–1. Pace is `mm:ss/km` **only** at the form/export edge.
- Decisions of record (do not re-litigate — amend `docs/domain.md` first if
  wrong): 13 (pace = metadata, never an engine input), 14 (tempo reps stay
  `continuous`; floor is per-rep), 15 (turn priority left>right>straight;
  graceful degradation with a crossing count).
- Changing `TempoSession`'s shape is a **breaking type change**: every `switch`
  over `Session` and every `TempoSession` literal (compiler, profiles, parse,
  format, `plan.ts` `describeSession`, and all their tests) updates in the
  **same commit** so the suite never goes red.
- Engine stays pace-free: no `import`, field, or reference to pace under
  `src/lib/engine/`.
- Commit messages: conventional commits ending
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Open interpretation to confirm with the owner

- **Turn-preference scope.** Decision 15 is written to apply to *all*
  work-stretch finding. The original ask said "interval stretches"; short
  interval reps rarely reach a junction before the rep ends, so in practice the
  rule bites hardest on tempo. Scoped to all types unless the owner narrows it.
- **What counts as a counted "crossing"** and the "major road" class threshold
  (tertiary-and-up vs secondary-and-up) — pinned in Task 5, flagged for review.

## Tasks

### Slice 0 — Contract (landed)

- [x] Amend `docs/domain.md` (decisions 13–15) + AGENTS.md units. *(commit `docs: add pace, tempo reps, and turn-aware stretch decisions`)*
- [x] Commit this plan and claim it (`Status: in progress`).

### Slice 1 — Domain model: pace + tempo reps

- [ ] `types.ts`: add `targetPaceSecondsPerKm` to `TempoSession`,
      `IntervalsSession`, `HillsSession`; grow `TempoSession` with `reps` +
      `recovery`. `tempoMeters` is the per-rep block.
- [ ] `compiler.ts`: validate pace (finite positive) and tempo `reps` (int
      >= 1); extend `workMetersFor` for tempo (`reps × block + recoveries`,
      reusing `JOG_RECOVERY_FACTOR`); tempo stays `continuous`.
- [ ] `profiles.ts`: `minUninterruptedMeters = min(session.tempoMeters, 1500)`
      is already per-block once `tempoMeters` is the block — confirm + test.
- [ ] `results/format.ts`: tempo summary/slug show reps (`3 × 2.0 km tempo`);
      add a pace formatter (`sec/km → mm:ss/km`).
- [ ] `plan.ts` `describeSession`: tempo name reflects reps.
- [ ] Update every affected test in the same commit; add tests pinning the new
      compiler behaviour and the pace formatter.

### Slice 2 — Input boundary: form + parse

- [ ] `session-input/parse.ts`: parse `mm:ss` (or plain sec) pace → seconds/km
      with friendly errors; add tempo `reps`/`recovery` fields; convert at edge.
- [ ] `src/app/planner.tsx` (+ form): pace input on tempo/intervals/hills;
      reps/recovery on tempo. Sensible defaults over knobs (USP: ease).
- [ ] Tests for pace parsing (valid `mm:ss`, bad input, plain seconds).

### Slice 3 — Export/results surfacing (v1 scope)

- [ ] Surface target pace in the results view and the GPX `<desc>`/name.
      Structured per-step watch targets (TCX/FIT) are **post-v1** — note, don't
      build. (Decision 3: planning tool; v1 is GPX + map.)

### Slice 4 — Engine: turn-aware stretch assembly

- [ ] `geo.ts`: left/right/straight classification from arrival + candidate
      bearings (reuse `bearingDegrees`/`angularDifferenceDegrees`).
- [ ] `chains.ts`: at a genuine junction, instead of terminating, choose the
      continuation by priority left > right > straight; record a **crossing**
      when the chosen move is a straight-across of a major road. `Chain` gains
      a crossing tally (JSON-safe array of node ids, like
      `toleratedJunctionNodeIds`).
- [ ] Keep determinism (walk-order independence) — the property the current
      mutual-continuation design protects. Re-derive the equivalent guarantee
      for turn selection.
- [ ] Tests against the Bristol fixture pinning turn choice and crossing tally.

### Slice 5 — Graceful degradation + caveat

- [ ] `finder.ts`/`evaluate.ts`: carry crossing count onto `WorkSegment`; rank
      crossing-free stretches above crossing ones; define the "major road"
      class threshold + what increments the count (flag for owner review).
- [ ] `plan.ts` `generateRoute`: stop throwing when the only stretches carry
      crossings — return the best one with its crossing count.
- [ ] `results/format.ts` + UI: caveat copy ("crosses N roads") on degraded
      results; keep the honest "search wider / different start" affordances.
- [ ] Tests: a fixture where only a crossing-bearing stretch fits returns a
      caveated result rather than an empty/throw.

### Slice 6 — (Conditional) sub-window finder

- [ ] Only if tempo is still unfindable after Slices 4–5: implement the
      long-deferred sub-window search (evaluate a qualifying window inside a
      longer chain rather than the whole chain — noted open in Route Engine B).
      Its own PR; may not be needed once turns + degradation land.
