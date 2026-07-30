# Segment Quality Score — Implementation Plan

**Status:** in progress · **Owner:** stuurps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`).

**Goal:** Replace the uncalibrated internal ranking heuristic with a single
**calibrated 0–1 quality score** that both ranks work segments and is surfaced
to the runner as "Quality 87%". Quality folds in the three things that make a
work stretch good or bad: **quietness**, **gradient fit**, and
**crossing-freeness** (road crossings are decision 15's forced-stop pace cost).
The road-crossing count stays visible as an explicit caveat alongside the score.

**Why this exists:** The results list showed three separate facts (quiet %,
grade, distance) and ranked by an unbounded internal `score`. Product direction:
one headline quality number per segment. A first pass built a *straightness*
penalty (turns are bad); that was **superseded by decision 15** (turns are free,
crossings are the cost) which landed first — so this plan drops straightness and
uses crossing-freeness as the pace-cost dimension instead.

**Architecture:** Three engine/UI changes, no new modules.
`evaluate.ts` stops returning the uncalibrated `score`; `evaluateChain` keeps
its pass/fail + `minQuietness` role (the cheap prefilter is unchanged), and a
new pure `segmentQuality({ minQuietness, gradientPercent, wantsClimb, crossings
})` returns the 0–1 blend (weights sum to 1: quietness 0.45, gradient 0.25,
crossing-freeness 0.30; crossing-freeness = 1/(1+crossings)). `finder.ts`
computes each `WorkSegment.quality` from that (crossings come from
`assembleStretches`), renames `WorkSegment.score → quality`, and **ranks purely
by quality** — crossings are now weighted in, replacing the strict
crossing-free-first primary sort (decision 16 refines decision 15's *ranking*;
assembly-time turn preference is untouched). `format.ts` gains `formatQuality`
(0–1 → "87%"); the planner row shows `Quality X% · distance away` plus the
existing `Crosses N roads` caveat.

**Tech Stack:** TypeScript, Vitest. No new dependencies. No network in tests.

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test` green at every commit.
- No `any`; units unchanged (quietness/quality 0–1, gradient %, distance m).
- Layering: `evaluate`/`finder` stay in `engine`; `segmentQuality` is pure.
- Decision-of-record change (decision 16) lands as its own commit, before code.

## Tasks

- [ ] Amend `docs/domain.md`: add decision 16 (single quality score; crossings
      weighted in; refines decision 15's ranking, caveat retained). Own commit.
- [ ] `evaluate.ts`: drop `score` from `ChainEvaluation`; add pure
      `segmentQuality(...)`; keep `evaluateChain` pass/fail + `minQuietness`.
- [ ] `finder.ts`: `WorkSegment.score → quality`; compute via `segmentQuality`
      (fold in `crossings`); sort by `quality` desc.
- [ ] `format.ts`: add `formatQuality`.
- [ ] `planner.tsx`: row shows `Quality X% · distance away`; keep crossings caveat.
- [ ] Tests: `evaluate.test.ts` (segmentQuality: quietness/gradient/crossing
      ordering + 0–1 range), `finder.test.ts` (crossing-free outranks
      crossing-bearing all else equal), `format.test.ts` (formatQuality).
