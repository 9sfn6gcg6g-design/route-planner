## Scorecard

<!-- REQUIRED. Fill this in first — it tells the reviewer how urgently to look
     and how carefully to read. Delete the options that don't apply. -->

| | Rating |
|---|---|
| **Impact** | 🟢 Low / 🟡 Medium / 🔴 High |
| **Breaking changes** | 🟢 None / 🟡 Minor / 🔴 Major |
| **Review priority** | 🟢 Whenever / 🟡 This week / 🔴 Before your next branch |

**Why this rating:** <!-- one sentence -->

<details>
<summary>What the ratings mean</summary>

**Impact — how far the change reaches**
- 🟢 **Low** — one module, self-contained. Nothing else has to change.
- 🟡 **Medium** — several modules, or it changes how contributors work.
- 🔴 **High** — cross-cutting: shared types (`domain/types.ts`,
  `engine/types.ts`), the scorer interface, or a decision of record.

**Breaking changes — what stops working**
- 🟢 **None** — existing behaviour and call sites are untouched.
- 🟡 **Minor** — a small local action is needed (re-run `npm ci`, update a
  couple of call sites, change one config value).
- 🔴 **Major** — existing behaviour or an API changes. **Say plainly what
  breaks and what the other person must do**, especially if they have a branch
  in flight that touches the same files.

**Review priority — how soon**
- 🟢 **Whenever** — no one is blocked.
- 🟡 **This week** — someone will build on it soon.
- 🔴 **Before your next branch** — merging anything else first causes conflicts
  or duplicated work.

</details>

## What changed and why

<!-- Plain English, no jargon. One bullet per change: what it is, and the
     problem it solves. Assume the reader has not seen the code. -->

Plan: <!-- e.g. docs/superpowers/plans/2026-07-26-route-engine-b-segment-finder.md, or "none — standalone" -->

## Anything the reviewer must do

<!-- Migrations, config to set, a manual step, something you couldn't finish.
     "Nothing" is a fine answer — but say it explicitly. -->

Nothing / <!-- describe -->

## Checklist

- [ ] Scorecard filled in above
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass
- [ ] No `any` types; no unexplained `@ts-expect-error` or lint disables
- [ ] Units are meters / percent / 0–1
- [ ] No network in tests — external calls go through injected functions
- [ ] Layering respected: `engine` imports `domain` **type-only**; `domain`
      imports nothing from `engine`
- [ ] New behaviour has colocated tests in the same commit
- [ ] Plan step checkboxes ticked and status header updated

## Decisions of record

<!-- Does this change contradict, or add to, docs/domain.md? If it amends a
     numbered decision, that amendment should be its own commit — link it. -->

None / <!-- describe -->
