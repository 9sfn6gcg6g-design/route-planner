import type { RecoveryType, Session } from '@/lib/domain/types'

/**
 * The form/API boundary that sits in front of the compiler (decision 10): it
 * turns raw form strings into a validated `Session` with friendly, per-field
 * error messages, so the compiler only ever sees well-formed input. Units are
 * converted at this edge — distances are entered in km, rep/hill lengths in
 * meters, and everything leaves here in meters.
 */
export interface SessionFormValues {
  type: Session['type']
  /** easy / long distance, km. */
  distanceKm: string
  /** tempo distance, km. */
  tempoKm: string
  /** intervals / hills rep count. */
  reps: string
  /** intervals rep length, meters. */
  repMeters: string
  /** intervals recovery style. */
  recovery: RecoveryType
  /** hills climb length, meters. */
  hillMeters: string
}

export type FieldErrors = Partial<Record<keyof SessionFormValues, string>>

export type ParseResult =
  | { ok: true; session: Session }
  | { ok: false; errors: FieldErrors }

function positiveNumber(raw: string): { value: number } | { error: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { error: 'Required' }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { error: 'Enter a number' }
  if (n <= 0) return { error: 'Must be greater than 0' }
  return { value: n }
}

function positiveInt(raw: string): { value: number } | { error: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { error: 'Required' }
  const n = Number(trimmed)
  if (!Number.isInteger(n)) return { error: 'Enter a whole number' }
  if (n < 1) return { error: 'Must be at least 1' }
  return { value: n }
}

const kmToMeters = (km: number): number => Math.round(km * 1000)

export function parseSessionForm(values: SessionFormValues): ParseResult {
  switch (values.type) {
    case 'easy': {
      const d = positiveNumber(values.distanceKm)
      if ('error' in d) return { ok: false, errors: { distanceKm: d.error } }
      return { ok: true, session: { type: 'easy', distanceMeters: kmToMeters(d.value) } }
    }
    case 'long': {
      const d = positiveNumber(values.distanceKm)
      if ('error' in d) return { ok: false, errors: { distanceKm: d.error } }
      return { ok: true, session: { type: 'long', distanceMeters: kmToMeters(d.value) } }
    }
    case 'tempo': {
      const d = positiveNumber(values.tempoKm)
      if ('error' in d) return { ok: false, errors: { tempoKm: d.error } }
      return { ok: true, session: { type: 'tempo', tempoMeters: kmToMeters(d.value) } }
    }
    case 'intervals': {
      const errors: FieldErrors = {}
      const reps = positiveInt(values.reps)
      const repMeters = positiveNumber(values.repMeters)
      if ('error' in reps) errors.reps = reps.error
      if ('error' in repMeters) errors.repMeters = repMeters.error
      if ('value' in reps && 'value' in repMeters) {
        return {
          ok: true,
          session: {
            type: 'intervals',
            reps: reps.value,
            repMeters: Math.round(repMeters.value),
            recovery: values.recovery,
          },
        }
      }
      return { ok: false, errors }
    }
    case 'hills': {
      const errors: FieldErrors = {}
      const reps = positiveInt(values.reps)
      const hillMeters = positiveNumber(values.hillMeters)
      if ('error' in reps) errors.reps = reps.error
      if ('error' in hillMeters) errors.hillMeters = hillMeters.error
      if ('value' in reps && 'value' in hillMeters) {
        return {
          ok: true,
          session: {
            type: 'hills',
            reps: reps.value,
            hillMeters: Math.round(hillMeters.value),
          },
        }
      }
      return { ok: false, errors }
    }
    default: {
      const exhaustive: never = values.type
      throw new Error(`Unhandled session type: ${JSON.stringify(exhaustive)}`)
    }
  }
}
