/**
 * Pillar 2 — routing. Public seam and composition root: compile a session, then
 * find the ground its work phase demands, behind injected I/O. To change how
 * routes are generated edit `plan-route.ts` (composition) or the `engine/*`
 * modules it calls; to change the elevation providers edit
 * `default-elevation-sampler.ts`.
 */
export { planRoute } from './plan-route'
export type { PlanRouteDeps, PlanRouteOptions, RoutePlan } from './plan-route'
export { createDefaultElevationSampler } from './default-elevation-sampler'
export type { ElevationProviders } from './default-elevation-sampler'
