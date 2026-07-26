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
10. The compiler enforces structural invariants — distances (`distanceMeters`, `tempoMeters`, `repMeters`, `hillMeters`) must be finite positive numbers, `reps` must be an integer >= 1, and an explicit `connectorMeters` override must be finite and positive — by throwing. This is not the place for friendly, user-facing validation messages or form constraints (min/max fields, helpful copy); that belongs at the form/API boundary that sits in front of the compiler. The compiler's contract is: garbage in throws, never silently produces a corrupt plan.
