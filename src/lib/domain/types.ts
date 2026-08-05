export type RecoveryType = 'jog' | 'static'

export interface EasySession {
  type: 'easy'
  distanceMeters: number
}

export interface LongSession {
  type: 'long'
  distanceMeters: number
}

export interface TempoSession {
  type: 'tempo'
  reps: number
  /** Per-rep tempo block length (decision 14). reps: 1 is a single block. */
  tempoMeters: number
  recovery: RecoveryType
  /** Optional target pace, seconds per km (decisions 13, 22). Workout metadata: never an engine input. */
  targetPaceSecondsPerKm?: number
}

export interface IntervalsSession {
  type: 'intervals'
  reps: number
  repMeters: number
  recovery: RecoveryType
  /** Optional target pace, seconds per km (decisions 13, 22). Workout metadata: never an engine input. */
  targetPaceSecondsPerKm?: number
}

export interface HillsSession {
  type: 'hills'
  reps: number
  hillMeters: number
  /** Optional target pace, seconds per km (decisions 13, 22). Workout metadata: never an engine input. */
  targetPaceSecondsPerKm?: number
}

export type Session =
  | EasySession
  | LongSession
  | TempoSession
  | IntervalsSession
  | HillsSession

export type SurfaceClass = 'paved' | 'any'

/**
 * How much each quality dimension counts toward the single 0–1 score, per
 * session type (decision 18). Two families: ground (quietness, gradient) and
 * flow (crossingFree, turnSmoothness, turnDensity, nonRepetition), plus
 * decision 17's lengthFit for conversational sessions. Weights must sum to 1 so
 * quality lands in [0, 1]. Chosen in `domain` and read by `engine` type-only, so
 * the engine gains the profile but never sees pace (decisions 13, 22): a flow
 * profile is terrain-shaping metadata, not pace.
 */
export interface QualityWeights {
  quietness: number
  gradient: number
  crossingFree: number
  turnSmoothness: number
  turnDensity: number
  nonRepetition: number
  /** Stretch length over the capped work-phase target (decision 17). Work
   *  sessions gate on `minUninterruptedMeters` instead and weight this 0. */
  lengthFit: number
}

/**
 * The gradient shape the session reads (decision 19). `even` rewards low
 * gradient variance (tempo); `sustained` rewards one continuous climb (hills);
 * `any` scores on the average alone (easy/long).
 */
export type GradientShape = 'any' | 'even' | 'sustained'

export interface TerrainRequirements {
  /** Mean |gradient| ceiling along the work segment, in percent. */
  maxAvgGradientPercent: number
  /** Hills sessions demand climb; null for every other type. */
  minAvgGradientPercent: number | null
  maxJunctionsPerKm: number
  /** 0–1, 1 = quietest. Road-class proxy until imagery/feedback signals exist. */
  minQuietness: number
  surface: SurfaceClass
  /** Longest stretch the runner must cover without a forced stop; null = no requirement. */
  minUninterruptedMeters: number | null
  /** Per-session quality blend (decision 18). */
  qualityWeights: QualityWeights
  /** Gradient shape this session reads (decision 19). */
  gradientShape: GradientShape
}

export type PhaseKind = 'warmup' | 'work' | 'cooldown'

export interface PhasePlan {
  kind: PhaseKind
  targetMeters: number
  /** null = relaxed (any runnable terrain) — used for connectors. */
  requirements: TerrainRequirements | null
}

export type WorkPattern = 'continuous' | 'laps'

export interface SessionPlan {
  session: Session
  phases: PhasePlan[]
  workPattern: WorkPattern
  totalMeters: number
}

export interface CompilerConfig {
  /** Override the warmup/cooldown connector length (meters each way). */
  connectorMeters?: number
}
