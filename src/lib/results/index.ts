/**
 * Pillar 4 — visual output. Public seam: the pure presentation helpers and the
 * GPX-download builder the UI renders. The React components live in
 * `src/app/planner/*` and `src/app/route-map.tsx`; the formatting they show and
 * the file they export are decided here. To change wording, formatting or the
 * GPX contents, edit `format.ts` / `gpx-download.ts`.
 */
export {
  crossingCaveat,
  formatGradient,
  formatKm,
  formatPace,
  formatPercent01,
  formatQuality,
  gpxFileName,
  sessionSummary,
  sessionTargetPace,
} from './format'
export { buildGpxDownload } from './gpx-download'
export type { GpxDownload } from './gpx-download'
