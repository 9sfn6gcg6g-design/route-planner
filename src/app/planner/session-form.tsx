'use client'

import { useState } from 'react'
import type { Session } from '@/lib/domain/types'
import {
  parseSessionForm,
  type FieldErrors,
  type SessionFormValues,
} from '@/lib/session-input'
import { Field, PaceField, SectionHead, inputClass } from './fields'

/**
 * Pillar 1 — user input. Owns the raw form values and per-field errors, runs
 * them through `parseSessionForm` (the form/API boundary in front of the
 * compiler, decision 10), and hands a validated `Session` up to the shell.
 * `startSlot` renders the start-point section inside the same `<form>` so the
 * DOM and submit behaviour are unchanged.
 */

const SESSION_TYPES: Array<{ value: Session['type']; label: string; blurb: string }> = [
  { value: 'easy', label: 'Easy', blurb: 'Relaxed steady run' },
  { value: 'long', label: 'Long', blurb: 'Longer steady effort' },
  { value: 'tempo', label: 'Tempo', blurb: 'Sustained hard effort' },
  { value: 'intervals', label: 'Intervals', blurb: 'Reps with recovery' },
  { value: 'hills', label: 'Hills', blurb: 'Hill repeats' },
]

const EMPTY_VALUES: SessionFormValues = {
  type: 'easy',
  distanceKm: '',
  tempoKm: '',
  reps: '',
  repMeters: '',
  recovery: 'jog',
  hillMeters: '',
  targetPace: '',
}

export function SessionForm({
  loading,
  hasStart,
  onDirty,
  onSubmit,
  startSlot,
}: {
  loading: boolean
  hasStart: boolean
  /** Editing any field discards the current results (back to idle). */
  onDirty: () => void
  onSubmit: (session: Session) => void
  startSlot: React.ReactNode
}) {
  const [values, setValues] = useState<SessionFormValues>(EMPTY_VALUES)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  function setField<K extends keyof SessionFormValues>(name: K, value: SessionFormValues[K]) {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => ({ ...e, [name]: undefined }))
    onDirty()
  }

  /** Switch session type, defaulting tempo to a single block for minimal input. */
  function selectType(type: Session['type']) {
    setValues((v) => ({ ...v, type, reps: type === 'tempo' && v.reps === '' ? '1' : v.reps }))
    setErrors({})
    onDirty()
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    const result = parseSessionForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    if (!hasStart) {
      setFormError('Set a start point first — use your location or a postcode.')
      return
    }
    setErrors({})
    onSubmit(result.session)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHead num="01" title="The session" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SESSION_TYPES.map((t) => {
            const isSelected = values.type === t.value
            return (
              <button
                type="button"
                key={t.value}
                onClick={() => selectType(t.value)}
                aria-pressed={isSelected}
                className={
                  'rounded-sm border px-3 py-2 text-left transition ' +
                  (isSelected
                    ? 'border-accent bg-accent text-paper'
                    : 'border-rule hover:border-accent')
                }
              >
                <span className="block text-sm font-semibold">{t.label}</span>
                <span
                  className={
                    'block text-xs ' + (isSelected ? 'text-paper/75' : 'text-ink-faint')
                  }
                >
                  {t.blurb}
                </span>
              </button>
            )
          })}
        </div>

        {(values.type === 'easy' || values.type === 'long') && (
          <Field label="Distance" hint="in kilometres" error={errors.distanceKm}>
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="e.g. 8"
              value={values.distanceKm}
              onChange={(e) => setField('distanceKm', e.target.value)}
            />
          </Field>
        )}

        {values.type === 'tempo' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reps" hint="tempo blocks" error={errors.reps}>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="e.g. 1"
                value={values.reps}
                onChange={(e) => setField('reps', e.target.value)}
              />
            </Field>
            <Field label="Block length" hint="in kilometres" error={errors.tempoKm}>
              <input
                className={inputClass}
                inputMode="decimal"
                placeholder="e.g. 5"
                value={values.tempoKm}
                onChange={(e) => setField('tempoKm', e.target.value)}
              />
            </Field>
            {values.reps !== '1' && (
              <Field label="Recovery" hint="between blocks">
                <select
                  className={inputClass}
                  value={values.recovery}
                  onChange={(e) =>
                    setField('recovery', e.target.value === 'static' ? 'static' : 'jog')
                  }
                >
                  <option value="jog">Jog</option>
                  <option value="static">Standing</option>
                </select>
              </Field>
            )}
            <PaceField value={values.targetPace} onChange={setField} error={errors.targetPace} />
          </div>
        )}

        {values.type === 'intervals' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reps" error={errors.reps}>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="e.g. 6"
                value={values.reps}
                onChange={(e) => setField('reps', e.target.value)}
              />
            </Field>
            <Field label="Rep length" hint="in metres" error={errors.repMeters}>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="e.g. 800"
                value={values.repMeters}
                onChange={(e) => setField('repMeters', e.target.value)}
              />
            </Field>
            <Field label="Recovery">
              <select
                className={inputClass}
                value={values.recovery}
                onChange={(e) =>
                  setField('recovery', e.target.value === 'static' ? 'static' : 'jog')
                }
              >
                <option value="jog">Jog</option>
                <option value="static">Standing</option>
              </select>
            </Field>
            <PaceField value={values.targetPace} onChange={setField} error={errors.targetPace} />
          </div>
        )}

        {values.type === 'hills' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Reps" error={errors.reps}>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="e.g. 8"
                value={values.reps}
                onChange={(e) => setField('reps', e.target.value)}
              />
            </Field>
            <Field label="Hill length" hint="in metres" error={errors.hillMeters}>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="e.g. 150"
                value={values.hillMeters}
                onChange={(e) => setField('hillMeters', e.target.value)}
              />
            </Field>
            <PaceField value={values.targetPace} onChange={setField} error={errors.targetPace} />
          </div>
        )}
      </section>

      {startSlot}

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={loading}
          className="self-start rounded-sm bg-accent px-7 py-3 font-mono text-xs uppercase tracking-[0.18em] text-paper transition hover:bg-accent-ink disabled:opacity-50"
        >
          {loading ? 'Finding routes…' : 'Find my route'}
        </button>
        {formError && <p className="text-sm text-red-700 dark:text-red-400">{formError}</p>}
      </div>
    </form>
  )
}
