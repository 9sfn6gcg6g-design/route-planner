'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Session } from '@/lib/domain/types'
import type { LatLon } from '@/lib/engine/types'
import type { WorkSegment } from '@/lib/engine/finder'
import { fetchWays } from '@/lib/engine/overpass'
import { fetchElevations } from '@/lib/engine/elevation'
import { createTerrariumSampler, fetchTerrariumTile } from '@/lib/engine/terrarium'
import { fetchOpenElevations } from '@/lib/engine/open-elevation'
import { withElevationFailover } from '@/lib/engine/elevation-chain'
import { geocodePostcode, PostcodeNotFoundError } from '@/lib/engine/geocode'
import { planRoute } from '@/lib/planner/plan-route'
import { buildGpxTrack } from '@/lib/export/gpx'
import {
  crossingCaveat,
  formatKm,
  formatPace,
  formatQuality,
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
  loading: () => <div className="h-80 w-full rounded-sm bg-paper-warm" />,
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
  // Pace/tempo-reps form inputs are wired in Slice 2; default keeps parse happy.
  targetPace: '',
}

/**
 * Terrain tiles first (keyless, cached, no meaningful quota), then the two
 * hosted APIs as fallbacks — Open-Meteo's per-coordinate quota weighting made
 * it unusable as the sole provider (a burst of searches exhausts the hourly
 * budget and every later search dies on its first elevation batch).
 * Module-scoped so the tile cache survives across searches.
 */
const sampleElevations = withElevationFailover([
  createTerrariumSampler(fetchTerrariumTile),
  fetchOpenElevations,
  fetchElevations,
])

const DEFAULT_RADIUS_METERS = 1200
const MAX_RADIUS_METERS = 8000

const inputClass =
  'w-full rounded-sm border border-rule bg-paper-warm px-3 py-2 text-ink outline-none ' +
  'transition placeholder:text-ink-faint focus:border-accent'

const kickerClass = 'font-mono text-[0.7rem] uppercase tracking-[0.16em] text-ink-faint'

// Route search is network-bound and slow (Overpass + elevation), so it gets an
// indeterminate bar and rotating status lines rather than a frozen button.
const SEARCH_PHRASES = [
  'Scanning the streets around you…',
  'Pulling the map from OpenStreetMap…',
  'Tracing quiet, runnable ground…',
  'Reading the gradients…',
  'Weighing up your options…',
  'Ranking the best stretches…',
  'Almost there…',
]

function SearchProgress() {
  const [i, setI] = useState(() => Math.floor(Math.random() * SEARCH_PHRASES.length))
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % SEARCH_PHRASES.length), 2200)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <div className="progress-track h-[3px] w-full rounded bg-paper-deep" aria-hidden>
        <span className="bg-accent" />
      </div>
      <p className={kickerClass}>{SEARCH_PHRASES[i]}</p>
    </div>
  )
}

type RunState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'done'
      session: Session
      start: LatLon
      segments: WorkSegment[]
      radiusMeters: number
    }

function SectionHead({ num, title }: { num: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-rule pb-2">
      <span className="font-mono text-[0.7rem] tracking-[0.2em] text-accent-ink">{num}</span>
      <h2 className="font-serif text-lg font-normal tracking-tight">{title}</h2>
    </div>
  )
}

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
    <label className="flex flex-col gap-1.5">
      <span className={kickerClass}>{label}</span>
      {children}
      {hint && !error && (
        <span className="font-mono text-[0.7rem] tracking-wide text-ink-faint">{hint}</span>
      )}
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </label>
  )
}

/** Target pace in seconds/km for structured sessions; null for easy/long. */
function sessionPace(session: Session): number | null {
  return session.type === 'easy' || session.type === 'long'
    ? null
    : session.targetPaceSecondsPerKm
}

function PaceField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (name: 'targetPace', value: string) => void
  error?: string
}) {
  return (
    <Field label="Target pace" hint="mm:ss per km" error={error}>
      <input
        className={inputClass}
        inputMode="text"
        placeholder="e.g. 5:10"
        value={value}
        onChange={(e) => onChange('targetPace', e.target.value)}
      />
    </Field>
  )
}

function downloadGpx(session: Session, segment: WorkSegment) {
  const pace = sessionPace(session)
  const gpx = buildGpxTrack(segment.points, {
    name: sessionSummary(session),
    description: pace !== null ? `Target pace ${formatPace(pace)}` : undefined,
  })
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

  /** Switch session type, defaulting tempo to a single block for minimal input. */
  function selectType(type: Session['type']) {
    setValues((v) => ({ ...v, type, reps: type === 'tempo' && v.reps === '' ? '1' : v.reps }))
    setErrors({})
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

  async function runPlan(session: Session, startPoint: LatLon, radiusMeters: number) {
    setSelected(0)
    setRun({ status: 'loading' })
    try {
      const plan = await planRoute(
        session,
        startPoint,
        { fetchWays, sampleElevations },
        { searchRadiusMeters: radiusMeters },
      )
      setRun({ status: 'done', session, start: startPoint, segments: plan.segments, radiusMeters })
    } catch {
      setRun({
        status: 'error',
        message:
          'Could not search right now — the map or elevation service may be busy. Please try again in a moment.',
      })
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
    await runPlan(result.session, start, DEFAULT_RADIUS_METERS)
  }

  return (
    <div className="flex flex-col gap-10">
      <form onSubmit={onSubmit} className="flex flex-col gap-8">
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

        <section className="flex flex-col gap-4">
          <SectionHead num="02" title="Your start" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={useMyLocation}
              className="rounded-sm border border-rule px-4 py-2 text-sm font-medium transition hover:border-accent"
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
                className="rounded-sm border border-rule px-4 py-2 text-sm font-medium transition hover:border-accent disabled:opacity-50"
              >
                {lookingUp ? 'Looking up…' : 'Set'}
              </button>
            </div>
          </div>
          {startStatus && (
            <p className="font-mono text-[0.7rem] tracking-wide text-ink-faint">{startStatus}</p>
          )}
        </section>

        <div className="flex flex-col gap-3">
          <button
            type="submit"
            disabled={run.status === 'loading'}
            className="self-start rounded-sm bg-accent px-7 py-3 font-mono text-xs uppercase tracking-[0.18em] text-paper transition hover:bg-accent-ink disabled:opacity-50"
          >
            {run.status === 'loading' ? 'Finding routes…' : 'Find my route'}
          </button>
          {formError && <p className="text-sm text-red-700 dark:text-red-400">{formError}</p>}
        </div>
      </form>

      <Results
        run={run}
        selected={selected}
        onSelect={setSelected}
        onWiden={
          run.status === 'done' && run.radiusMeters < MAX_RADIUS_METERS
            ? () =>
                runPlan(
                  run.session,
                  run.start,
                  Math.min(run.radiusMeters * 2, MAX_RADIUS_METERS),
                )
            : undefined
        }
      />
    </div>
  )
}

function Results({
  run,
  selected,
  onSelect,
  onWiden,
}: {
  run: RunState
  selected: number
  onSelect: (index: number) => void
  onWiden?: () => void
}) {
  if (run.status === 'idle') return null
  if (run.status === 'loading') {
    return <SearchProgress />
  }
  if (run.status === 'error') {
    return <p className="text-sm text-red-700 dark:text-red-400">{run.message}</p>
  }

  const { session, start, segments } = run
  if (segments.length === 0) {
    return (
      <div className="flex flex-col gap-3 border-l-2 border-accent bg-paper-warm px-4 py-4">
        <p className="text-sm text-ink-soft">
          No stretches suited to a {sessionSummary(session).toLowerCase()} turned up within{' '}
          {formatKm(run.radiusMeters)} of your start. You could search a wider area, choose a
          different start point, or try another session type.
        </p>
        {onWiden && (
          <button
            type="button"
            onClick={onWiden}
            className="self-start rounded-sm border border-accent px-5 py-2 font-mono text-xs uppercase tracking-[0.16em] text-accent-ink transition hover:bg-accent hover:text-paper"
          >
            Search a wider area
          </button>
        )}
      </div>
    )
  }

  const index = Math.min(selected, segments.length - 1)
  const current = segments[index]
  const count = segments.length
  const pace = sessionPace(session)

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule pb-2">
        <span className="font-mono text-[0.7rem] tracking-[0.2em] text-accent-ink">03</span>
        <h2 className="font-serif text-lg font-normal tracking-tight">
          {count} {count > 1 ? 'stretches' : 'stretch'}
        </h2>
        <span className="ml-auto font-mono text-[0.7rem] tracking-wide text-ink-faint">
          for {sessionSummary(session)}
          {pace !== null && ` · ${formatPace(pace)}`}
        </span>
      </div>

      <RouteMap start={start} route={current.points} />

      <ul className="flex flex-col">
        {segments.map((segment, i) => {
          const isCurrent = i === index
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-pressed={isCurrent}
                className={
                  'flex w-full items-baseline gap-4 border-l-2 px-3 py-3 text-left transition ' +
                  (isCurrent
                    ? 'border-accent bg-paper-warm'
                    : 'border-transparent hover:bg-paper-warm/60')
                }
              >
                <span className="font-mono text-[0.7rem] tracking-widest text-ink-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-serif text-base">{formatKm(segment.lengthMeters)}</span>
                  <span className="tabular font-mono text-[0.7rem] tracking-wide text-ink-soft">
                    Quality {formatQuality(segment.quality)} ·{' '}
                    {formatKm(segment.distanceFromStartMeters)} away
                  </span>
                  {crossingCaveat(segment.crossings) && (
                    <span className="font-mono text-[0.7rem] tracking-wide text-accent-ink">
                      {crossingCaveat(segment.crossings)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() => downloadGpx(session, current)}
        className="self-start rounded-sm border border-ink px-6 py-3 font-mono text-xs uppercase tracking-[0.18em] text-ink transition hover:bg-ink hover:text-paper"
      >
        Download GPX
      </button>
      <p className="font-mono text-[0.7rem] leading-relaxed tracking-wide text-ink-faint">
        Map data © OpenStreetMap contributors. This is the session&rsquo;s work stretch — the ground
        that suits the session, not yet a full loop from your door. Connecting it into a door-to-door
        route comes next (v1.1).
      </p>
    </section>
  )
}
