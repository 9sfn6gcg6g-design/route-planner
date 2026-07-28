## What and why

<!-- One or two sentences. Link the plan this slice belongs to. -->

Plan: <!-- e.g. docs/superpowers/plans/2026-07-26-route-engine-b-segment-finder.md, or "none — standalone" -->

## Checklist

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
