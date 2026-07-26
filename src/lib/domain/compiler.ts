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
