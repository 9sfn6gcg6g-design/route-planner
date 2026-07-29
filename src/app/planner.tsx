'use client'

import { useState } from 'react'
import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import { geocodePostcode, PostcodeNotFoundError } from '@/lib/engine/geocode'
import {
  parseSessionForm,
  type FieldErrors,
  type SessionFormValues,
} from '@/lib/session-input/parse'

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
}

const inputClass =
  'w-full rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 ' +
  'outline-none focus:border-black/50 dark:focus:border-white/60'

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && !error && <span className="text-xs opacity-60">{hint}</span>}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  )
}

export default function Planner() {
  const [values, setValues] = useState<SessionFormValues>(EMPTY_VALUES)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [start, setStart] = useState<LatLon | null>(null)
  const [startStatus, setStartStatus] = useState<string | null>(null)
  const [postcode, setPostcode] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [plan, setPlan] = useState<{ session: Session; start: LatLon } | null>(null)

  function setField<K extends keyof SessionFormValues>(name: K, value: SessionFormValues[K]) {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => ({ ...e, [name]: undefined }))
    setPlan(null)
  }

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStartStatus('Location is not available — enter a postcode instead.')
      return
    }
    setStartStatus('Finding your location…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStart({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setStartStatus('Using your current location.')
      },
      () => setStartStatus('Could not get your location — enter a postcode instead.'),
    )
  }

  async function lookupPostcode() {
    if (postcode.trim() === '') return
    setLookingUp(true)
    setStartStatus('Looking up postcode…')
    try {
      const point = await geocodePostcode(postcode)
      setStart(point)
      setStartStatus(`Start set from ${postcode.trim().toUpperCase()}.`)
    } catch (err) {
      setStart(null)
      setStartStatus(
        err instanceof PostcodeNotFoundError
          ? 'Postcode not found — check it and try again.'
          : 'Postcode lookup failed — please try again.',
      )
    } finally {
      setLookingUp(false)
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    const result = parseSessionForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    if (!start) {
      setFormError('Set a start point first — use your location or a postcode.')
      return
    }
    setErrors({})
    setPlan({ session: result.session, start })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">What&rsquo;s the session?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SESSION_TYPES.map((t) => {
            const selected = values.type === t.value
            return (
              <button
                type="button"
                key={t.value}
                onClick={() => setField('type', t.value)}
                aria-pressed={selected}
                className={
                  'rounded-lg border px-3 py-2 text-left transition ' +
                  (selected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-black/15 dark:border-white/20 hover:border-black/40 dark:hover:border-white/40')
                }
              >
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block text-xs opacity-70">{t.blurb}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

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
        <Field label="Tempo distance" hint="in kilometres" error={errors.tempoKm}>
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder="e.g. 5"
            value={values.tempoKm}
            onChange={(e) => setField('tempoKm', e.target.value)}
          />
        </Field>
      )}

      {values.type === 'intervals' && (
        <div className="grid gap-4 sm:grid-cols-3">
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
        </div>
      )}

      {values.type === 'hills' && (
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Where do you start?</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={useMyLocation}
            className="rounded-lg border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium hover:border-black/40 dark:hover:border-white/40"
          >
            Use my location
          </button>
          <div className="flex flex-1 gap-2">
            <input
              className={inputClass}
              placeholder="or a UK postcode"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
            />
            <button
              type="button"
              onClick={lookupPostcode}
              disabled={lookingUp}
              className="rounded-lg border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium hover:border-black/40 dark:hover:border-white/40 disabled:opacity-50"
            >
              {lookingUp ? 'Looking up…' : 'Set'}
            </button>
          </div>
        </div>
        {startStatus && <p className="text-xs opacity-70">{startStatus}</p>}
      </fieldset>

      <button
        type="submit"
        className="rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:opacity-90"
      >
        Find my route
      </button>
      {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}

      {plan && (
        <section className="rounded-xl border border-black/10 dark:border-white/15 p-4 text-sm">
          <h2 className="mb-2 font-semibold">Ready to generate</h2>
          <p className="opacity-70">
            {describeSession(plan.session)} from {plan.start.lat.toFixed(4)},{' '}
            {plan.start.lon.toFixed(4)}.
          </p>
          <p className="mt-2 text-xs opacity-60">
            Route generation and the map preview arrive next (Slice 5).
          </p>
        </section>
      )}
    </form>
  )
}

function describeSession(session: Session): string {
  switch (session.type) {
    case 'easy':
      return `Easy ${(session.distanceMeters / 1000).toFixed(1)} km`
    case 'long':
      return `Long ${(session.distanceMeters / 1000).toFixed(1)} km`
    case 'tempo':
      return `Tempo ${(session.tempoMeters / 1000).toFixed(1)} km`
    case 'intervals':
      return `${session.reps} × ${session.repMeters} m intervals (${session.recovery} recovery)`
    case 'hills':
      return `${session.reps} × ${session.hillMeters} m hills`
  }
}
