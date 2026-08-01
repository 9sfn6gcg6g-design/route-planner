# Route Planner — Domain Model

An app for runners that generates routes *from the planned session*, not the
other way round. The session drives the route: intervals want flat, smooth,
quiet, uninterrupted ground; hill reps want gradient; easy runs relax
everything.

## Ubiquitous language

| Term | Meaning |
|------|---------|
| **Session** | What the runner plans to do: one of `easy`, `long`, `tempo`, `intervals`, `hills`, each with a minimal type-specific form. Structured sessions (`tempo`, `intervals`, `hills`) may also carry an **optional** runner-entered **target pace** (decisions 13, 17); `tempo` carries reps + recovery like intervals (decision 14). `easy`/`long` stay conversational (no pace). |
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
6. Engine is hybrid: our own work-segment finder (OSM + open elevation, scored graph) + hosted A→B routing for connectors (Openrouteservice). Elevation: AWS Open Data terrain tiles (terrarium encoding) sampled client-side, failing over to Open-Elevation and then Open-Meteo. *(Amended 2026-07-29: originally "Elevation: Open-Meteo" alone — its per-coordinate quota weighting means a handful of searches exhausts the hourly IP budget and every later search fails; terrain tiles are keyless, CORS-open, effectively unmetered, and cached per tile.)* *(Amended 2026-07-30, superseded for v1 by decision 21: connectors and loop assembly run on our **own `RunGraph`** — keyless shortest/quiet-path routing computed client-side (`engine/route.ts`), because no API key can ship in client JS on GitHub Pages (decision 12). Openrouteservice returns as a connector option only if/when a backend host exists (decision 9's scaling path). See decision 21.)*
7. Street imagery is post-MVP, Mapillary only (never scraped Street View), computed offline and cached — hence pluggable signals.
8. Accounts are **deferred to post-v1**; the v1 (GitHub Pages, decision 12) is account-less. When they land, accounts hold exactly three things — saved routes, saved start points, post-run route feedback (ground truth for segment quality) — on Clerk + Neon, which is why a server host (Vercel) returns post-v1. *(Amended 2026-07-29: the original MVP had accounts in scope; v1 dropped them to ship client-only.)*
9. Built for Liam first (UK-first, free tiers), architected to scale into a shippable product.
10. The compiler enforces structural invariants — distances (`distanceMeters`, `tempoMeters`, `repMeters`, `hillMeters`) must be finite positive numbers, `reps` must be an integer >= 1, and an explicit `connectorMeters` override must be finite and positive — by throwing. This is not the place for friendly, user-facing validation messages or form constraints (min/max fields, helpful copy); that belongs at the form/API boundary that sits in front of the compiler. The compiler's contract is: garbage in throws, never silently produces a corrupt plan.
11. Minor-join tolerance (2026-07-28): a degree->=3 node whose other joining ways are all minor (footway/path/cycleway/track/service) does not cut an uninterrupted stretch; it counts toward `maxJunctionsPerKm`, whose meaning is now "tolerated minor joins per km" (retuned: easy 12, long 10, tempo/intervals/hills 6). Crossing a major road still terminates — in both directions. Tempo requires `min(tempoMeters, 1500)` of uninterrupted stretch, run out-and-back.
12. **v1 ships client-only as a static export on GitHub Pages.** Overpass, elevation (decision 6's terrain-tile chain), and postcode geocoding (postcodes.io) run in the browser — all keyless and CORS-enabled; the start point comes from browser Geolocation with a UK-postcode fallback. v1 shows the session's **work segment(s)** with map preview + GPX download; **door-to-door loop assembly and Openrouteservice connectors (decisions 5/6) are out of v1** — a v1.1 follow-up — so no API key ships in client JS. Server-backed pieces (accounts, decision 8; a Vercel host, decision 9's scaling path) return post-v1. *(Added 2026-07-29.)*

13. **Structured sessions carry a target pace (2026-07-30).** Supersedes the
    "no pace input" note in the Session definition (and its restatement in the
    v1 plan). `tempo`, `intervals` and `hills` take a runner-entered **target
    pace**, stored as **seconds per kilometre** — a fixed unit, added to the
    AGENTS.md units list — and formatted `mm:ss/km` only at the form/export
    edge. Pace is **workout metadata**: it rides on the `Session`, is surfaced
    in results and the GPX description, and (post-v1) will drive structured
    watch targets — but it does **not** feed `TerrainRequirements` or the
    segment finder. The ground a session needs is unchanged by how fast it is
    run, so the engine layer never sees pace. `easy`/`long` remain
    conversational (an easy-pace target is a possible later addition). The
    compiler validates pace as a finite positive number under decision 10's
    contract (throws; no UX copy). Modelled on Runna/Coopah, which *derive*
    pace from a one-time goal rather than asking per session — v1 asks per
    session for simplicity; deriving from a goal is a possible later move.

14. **Tempo is reps × block + recovery (2026-07-30).** Supersedes the
    single-block tempo shape. `TempoSession` becomes `{ reps, tempoMeters,
    recovery, targetPaceSecondsPerKm }`, where `tempoMeters` is now the
    **per-rep block** length, mirroring `IntervalsSession`. Unlike
    intervals/hills, a multi-rep tempo stays `WorkPattern: continuous` — the
    runner keeps moving along one continuous stretch and jogs the recoveries;
    the reps are a **workout-timing overlay, not repeated laps of a segment**.
    The finder therefore still consumes only distance + terrain: decision 11's
    floor, `minUninterruptedMeters = min(tempoMeters, 1500)`, now measures the
    **per-rep** block. Recovery distance follows the existing jog-recovery
    convention (half the block) until tuned. `reps` validates as an integer
    >= 1 (decision 10); `reps: 1` is the classic single-block tempo.

15. **Work stretches prefer turns over crossings; results degrade gracefully
    (2026-07-30).** Amends the continuous/uninterrupted-stretch principle
    (decision 11). A work stretch is **no longer a straight corridor**. When
    extending a stretch through a real junction, the finder prefers, in strict
    order: (1) a **left turn**, (2) a **right turn**, (3) going **straight
    across** — a road crossing. The rationale (from the runner): turns are
    free, a crossing is a forced stop, so minimise crossings by turning; left
    before right keeps the runner on the nearside without crossing the
    carriageway. This layers on top of decision 11's minor-join tolerance
    (minor joins still don't even count as junctions to navigate); it governs
    behaviour at genuine junctions of comparable roads, where decision 11
    previously **terminated** the stretch. Crossing a **major** road stays the
    interruption that matters. Where no crossing-free stretch of the required
    length exists near the start, the finder **no longer returns nothing**: it
    returns the best available stretch **annotated with the road crossings it
    entails**, so the UI presents it with a caveat ("crosses N roads") instead
    of failing outright. Applies to all work-stretch finding (tempo,
    intervals, hills). The precise junction geometry — how left/right/straight
    are decided, and which highway classes count as a "major" crossing — is
    fixed in the implementing plan, not here.
16. **A segment has one quality score, 0–1, shown as a percentage
    (2026-07-30).** The finder ranks candidate work segments, and the UI
    presents them, by a single calibrated **quality** score — a weighted blend
    of **quietness** (0.45), **gradient fit** (0.25; flatness, or steepness when
    the session wants climb) and **crossing-freeness** (0.30; `1/(1+crossings)`,
    where `crossings` is decision 15's forced-stop count). It replaces the
    earlier unbounded ranking heuristic: because it is surfaced to the runner
    ("Quality 87%"), it must be a real 0–1 quantity. Quality **only orders
    segments that already qualify**; the hard `TerrainRequirements` (length,
    quietness floor, surface, junction density, gradient bounds) remain separate
    pass/fail gates. This **refines decision 15's *ranking***: crossings are now
    weighted *into* quality rather than being a strict crossing-free-first
    primary sort, so a much quieter/flatter stretch can outrank one with a
    crossing — but crossing-freeness is weighted heavily enough that, all else
    equal, crossing-free still leads. Decision 15's **assembly** behaviour (turn
    before crossing; left before right) and its **explicit caveat** ("crosses N
    roads", shown alongside the score) are unchanged. The blend weights are v1
    constants in `engine/evaluate.ts`, tunable, and are the natural home for
    future signals (decision 7) — a new signal slots in as another weighted
    dimension without reshaping the interface.

17. **Target pace is optional (2026-07-30).** Amends decisions 13 and 14: the
    runner-entered **target pace** on `tempo`, `intervals` and `hills` is now
    **optional, not required**. `targetPaceSecondsPerKm` becomes an optional
    field on those sessions; everything else in decision 13 stands — when
    present it is still stored as **seconds per kilometre**, formatted
    `mm:ss/km` only at the edge, surfaced in results and the GPX description,
    and still **never** an engine input. The rationale: pace is workout
    metadata, so demanding it just to generate a route is friction the runner
    shouldn't have to clear — a session with no target still yields a route,
    and the results/GPX simply omit the pace line (exactly as `easy`/`long`
    already do). This shifts pace validation under decision 10: the compiler
    still throws on a **present** non-finite or non-positive pace, but an
    **absent** pace (`undefined`) is valid — it is no longer part of the
    structural contract. At the form/API boundary, an empty pace field is
    accepted rather than erroring "Required". Decision 14's `TempoSession`
    shape reads `{ reps, tempoMeters, recovery, targetPaceSecondsPerKm? }`
    accordingly.

18. **Route quality is two families; flow is session-weighted (2026-07-31).**
    Amends decisions 15 and 16. A route's quality splits into two families: the
    **ground** it covers (quietness, gradient fit) and the **flow** of running it
    — how well the line keeps moving the way the session wants. Flow has four
    dimensions, all 0–1, 1 = best: **crossing-freeness** (decision 16, formula
    unchanged), **turn-smoothness** (gentle sweeps cost nothing; sharp turns cost
    pace, hairpins most), **turn-density** (few direction changes make a legible,
    flowing line — many *gentle* turns still break a hard effort; distinct from
    `maxJunctionsPerKm`, which counts minor joins *passed through*, not turns
    *taken*), and **non-repetition** (`1 − repeatedDistance/totalDistance` across a
    loop or continuous route). Decision 16's quality weights stop being one global
    constant set and become a **profile keyed by session type**: structured work
    (tempo/intervals/hills) weights crossing-freeness and turn-smoothness/density
    high; easy/long weight those low and weight non-repetition high (a rep session
    repeats one segment by design, so non-repetition does not apply to its work —
    see decision 21). The **compiler picks the profile** from the session and
    passes it to the engine as part of what it already hands over
    (`TerrainRequirements`), so the engine gains the weight profile but still
    **never sees pace** (decisions 13, 17 stand) — a flow profile is
    terrain-shaping metadata, not pace. Assembly changes too: decision 15's strict
    left → right → straight preference becomes **gentlest non-crossing continuation
    first**, with left-before-right kept only as a tiebreak between equally gentle
    turns; a straight-across crossing stays the last resort and the tallied forced
    stop. The blend weights and the gentle/sharp turn thresholds are v1 constants
    in `engine/evaluate.ts`, tunable, and remain the home for future signals
    (decision 7) — a new signal slots in as another weighted flow or ground
    dimension without reshaping the interface.

19. **Gradient is shape-aware, not just an average (2026-07-31).** Refines the
    gradient dimension of decisions 15 and 16. An average gradient over a stretch
    is blind to distribution: rolling ground and a steady climb can share a mean.
    So the terrain requirement and the gradient-fit score read the **shape** of
    the climb, per session: **hills** demand one **sustained** climb over the rep
    length (not rolling ground that averages to target); **tempo** rewards **low
    gradient variance** (even ground for even pacing); **easy/long** stay on the
    average as today. The precise measures — how "sustained" and "variance" are
    computed and bounded — are fixed in the implementing plan, not here; units are
    unchanged (percent).

20. **Runnable ground excludes hard obstacles (2026-07-31).** A work stretch or
    loop must not route through a dead stop. `highway=steps` is already excluded at
    the Overpass query (it is not a runnable highway class); this decision adds
    **node barriers** — `barrier=gate`, `stile`, `kissing_gate`, `turnstile` and
    kin — which the current query does not fetch at all. The graph build fetches
    and honours them: an edge through a blocking barrier node is not runnable. A
    gate at graph construction, alongside the surface gate; the exact barrier list
    and any access-tag exceptions (e.g. `access=yes`, `foot=yes`) are fixed in the
    implementing plan.

21. **Loops are assembled on our own OSM graph, keyless, in v1 (2026-07-31).**
    Supersedes decision 6's "hosted A→B routing for connectors (Openrouteservice)"
    and amends decision 12: **door-to-door loop assembly moves from v1.1 into v1**,
    and runs entirely on the scored `RunGraph` we already build around the start.
    Connectors and closed-walk loops are shortest/quiet-path routing (Dijkstra/A*
    over `RunEdge` weights) on that graph — **client-side, no API key** — so the
    static GitHub Pages host (decision 12) is preserved; Openrouteservice returns
    only if a backend host ever exists (decision 9's scaling path). Every result
    becomes a route the runner can run from the door, exported as one continuous
    GPX (decision 4). **Hill reps are structurally special:** the lap is a
    sustained climb whose recovery is the **descent of the same climb**, so a hill
    lap retraces by design and **non-repetition (decision 18) is suspended for it**
    — the `back`-U-turn avoidance does not apply within the hill lap. Whether
    **tempo** stays out-and-back (decision 11) or becomes a loop is **resolved in
    the implementing plan**, not here. This promotes the existing
    `docs/superpowers/plans/2026-07-29-v1-door-to-door-loops.md`, which already
    chose this keyless-graph architecture.

---

Map data in test fixtures © OpenStreetMap contributors, licensed under ODbL (openstreetmap.org/copyright).
