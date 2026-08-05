'use client'

import dynamic from 'next/dynamic'
import type { Session } from '@/lib/domain/types'
import type { WorkSegment } from '@/lib/engine/finder'
import {
  buildGpxDownload,
  crossingCaveat,
  formatKm,
  formatPace,
  formatQuality,
  sessionSummary,
  sessionTargetPace,
} from '@/lib/results'
import { SearchProgress } from './fields'
import type { RunState } from './run-state'

/**
 * Pillar 4 — visual output. Renders the run lifecycle: progress, error, the
 * empty-area prompt, and the ranked segment list with map preview and GPX
 * download. Presentation only — all formatting comes from the pure
 * `results/format` helpers.
 */

const RouteMap = dynamic(() => import('../route-map'), {
  ssr: false,
  loading: () => <div className="h-80 w-full rounded-sm bg-paper-warm" />,
})

/** Build the GPX (pure) and trigger a browser download of it. */
function downloadGpx(session: Session, segment: WorkSegment) {
  const { fileName, mimeType, contents } = buildGpxDownload(session, segment.points)
  const blob = new Blob([contents], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function Results({
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
  const pace = sessionTargetPace(session)

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
