import type {
  CompilerConfig,
  PhasePlan,
  Session,
  SessionPlan,
  WorkPattern,
} from './types'
import { terrainRequirementsFor } from './profiles'

/** Jog recoveries between reps default to half the rep distance. */
const JOG_RECOVERY_FACTOR = 0.5

/** Warmup/cooldown default to 15% of work distance, clamped to 1–2km each. */
const CONNECTOR_SHARE = 0.15
const CONNECTOR_MIN_METERS = 1000
const CONNECTOR_MAX_METERS = 2000

/**
 * Structural invariants the compiler depends on: distances must be finite
 * and positive, and rep counts must be whole numbers >= 1. Violations throw
 * — this is not the place for friendly, UX-facing messages (see
 * docs/domain.md).
 */
function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a finite positive number, got ${value}`)
  }
}

function assertValidReps(reps: number): void {
  if (!Number.isInteger(reps) || reps < 1) {
    throw new Error(`reps must be an integer >= 1, got ${reps}`)
  }
}

function assertValidSession(session: Session): void {
  switch (session.type) {
    case 'easy':
    case 'long':
      assertFinitePositive(session.distanceMeters, 'distanceMeters')
      return
    case 'tempo':
      assertFinitePositive(session.tempoMeters, 'tempoMeters')
      return
    case 'intervals':
      assertValidReps(session.reps)
      assertFinitePositive(session.repMeters, 'repMeters')
      return
    case 'hills':
      assertValidReps(session.reps)
      assertFinitePositive(session.hillMeters, 'hillMeters')
      return
    default: {
      const exhaustive: never = session
      throw new Error(`Unhandled session type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

export function workMetersFor(session: Session): number {
  assertValidSession(session)
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
  assertValidSession(session)
  if (config.connectorMeters !== undefined) {
    assertFinitePositive(config.connectorMeters, 'connectorMeters')
  }

  const work = workMetersFor(session)
  const requirements = terrainRequirementsFor(session)

  // Exhaustive over Session['type'] so a future sixth session type fails
  // compilation here rather than silently falling into the connector-wrapped
  // branch below.
  let workPattern: WorkPattern
  let wrapped: boolean
  switch (session.type) {
    case 'easy':
    case 'long':
      workPattern = 'continuous'
      wrapped = false
      break
    case 'tempo':
      workPattern = 'continuous'
      wrapped = true
      break
    case 'intervals':
    case 'hills':
      workPattern = 'laps'
      wrapped = true
      break
    default: {
      const exhaustive: never = session
      throw new Error(`Unhandled session type: ${JSON.stringify(exhaustive)}`)
    }
  }

  if (!wrapped) {
    const phases: PhasePlan[] = [
      { kind: 'work', targetMeters: work, requirements },
    ]
    return { session, phases, workPattern, totalMeters: work }
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
    workPattern,
    totalMeters: connector * 2 + work,
  }
}
