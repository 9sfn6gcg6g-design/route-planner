'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import type { WorkSegment } from '@/lib/engine/finder'
import { fetchWays } from '@/lib/engine/overpass'
import { fetchElevations } from '@/lib/engine/elevation'
import { geocodePostcode, PostcodeNotFoundError } from '@/lib/engine/geocode'
import { planRoute } from '@/lib/planner/plan-route'
import { buildGpxTrack } from '@/lib/export/gpx'
import {
  formatGradient,
  formatKm,
  formatPercent01,
  gpxFileName,
  sessionSummary,
} from '@/lib/results/format'
import {
  parseSessionForm,
  type FieldErrors,
  type SessionFormValues,
} from '@/lib/session-input/parse'

const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => <div className="h-80 w-full rounded-xl bg-black/5 dark:bg-white/10" />,
})

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

type RunState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; session: Session; start: LatLon; segments: WorkSegment[] }

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

function downloadGpx(session: Session, segment: WorkSegment) {
  const gpx = buildGpxTrack(segment.points, { name: sessionSummary(session) })
  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = gpxFileName(session)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function Planner() {
  const [values, setValues] = useState<SessionFormValues>(EMPTY_VALUES)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [start, setStart] = useState<LatLon | null>(null)
  const [startStatus, setStartStatus] = useState<string | null>(null)
  const [postcode, setPostcode] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [selected, setSelected] = useState(0)

  function setField<K extends keyof SessionFormValues>(name: K, value: SessionFormValues[K]) {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => ({ ...e, [name]: undefined }))
    setRun({ status: 'idle' })
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

  async function onSubmit(event: React.FormEvent) {
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
    setSelected(0)
    setRun({ status: 'loading' })
    try {
      const plan = await planRoute(result.session, start, {
        fetchWays,
        sampleElevations: fetchElevations,
      })
      setRun({ status: 'done', session: result.session, start, segments: plan.segments })
    } catch {
      setRun({
        status: 'error',
        message:
          'Could not build a route right now — the map or elevation service may be busy. Please try again.',
      })
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">What&rsquo;s the session?</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SESSION_TYPES.map((t) => {
              const isSelected = values.type === t.value
              return (
                <button
                  type="button"
                  key={t.value}
                  onClick={() => setField('type', t.value)}
                  aria-pressed={isSelected}
                  className={
                    'rounded-lg border px-3 py-2 text-left transition ' +
                    (isSelected
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
          disabled={run.status === 'loading'}
          className="rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {run.status === 'loading' ? 'Finding routes…' : 'Find my route'}
        </button>
        {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
      </form>

      <Results run={run} selected={selected} onSelect={setSelected} />
    </div>
  )
}

function Results({
  run,
  selected,
  onSelect,
}: {
  run: RunState
  selected: number
  onSelect: (index: number) => void
}) {
  if (run.status === 'idle') return null
  if (run.status === 'loading') {
    return <p className="text-sm opacity-70">Searching for suitable ground near your start…</p>
  }
  if (run.status === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-400">{run.message}</p>
  }

  const { session, start, segments } = run
  if (segments.length === 0) {
    return (
      <p className="text-sm opacity-70">
        No stretches matching a {sessionSummary(session).toLowerCase()} were found within about
        2&nbsp;km. Try a different start point or session.
      </p>
    )
  }

  const current = segments[Math.min(selected, segments.length - 1)]

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">
        {segments.length} route{segments.length > 1 ? 's' : ''} for {sessionSummary(session)}
      </h2>

      <RouteMap start={start} route={current.points} />

      <ul className="flex flex-col gap-2">
        {segments.map((segment, i) => {
          const isCurrent = i === Math.min(selected, segments.length - 1)
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-pressed={isCurrent}
                className={
                  'w-full rounded-lg border px-4 py-3 text-left text-sm transition ' +
                  (isCurrent
                    ? 'border-foreground'
                    : 'border-black/10 dark:border-white/15 hover:border-black/30 dark:hover:border-white/30')
                }
              >
                <span className="font-medium">Option {i + 1}</span>
                <span className="opacity-70">
                  {' '}
                  · {formatKm(segment.lengthMeters)} · {formatPercent01(segment.minQuietness)} quiet
                  · {formatGradient(segment.avgAbsGradientPercent)} grade ·{' '}
                  {formatKm(segment.distanceFromStartMeters)} away
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() => downloadGpx(session, current)}
        className="self-start rounded-full border border-foreground px-6 py-3 text-sm font-semibold hover:bg-foreground hover:text-background"
      >
        Download GPX
      </button>
      <p className="text-xs opacity-60">
        Map data © OpenStreetMap contributors. This is the session&rsquo;s work stretch; connecting
        it into a full loop from your door comes next.
      </p>
    </section>
  )
}
