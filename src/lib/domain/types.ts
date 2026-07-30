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
  /** Runner's target pace, seconds per km (decision 13). Workout metadata: never an engine input. */
  targetPaceSecondsPerKm: number
}

export interface IntervalsSession {
  type: 'intervals'
  reps: number
  repMeters: number
  recovery: RecoveryType
  /** Runner's target pace, seconds per km (decision 13). Workout metadata: never an engine input. */
  targetPaceSecondsPerKm: number
}

export interface HillsSession {
  type: 'hills'
  reps: number
  hillMeters: number
  /** Runner's target pace, seconds per km (decision 13). Workout metadata: never an engine input. */
  targetPaceSecondsPerKm: number
}

export type Session =
  | EasySession
  | LongSession
  | TempoSession
  | IntervalsSession
  | HillsSession

export type SurfaceClass = 'paved' | 'any'

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
