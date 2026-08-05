'use client'

import { useEffect, useState } from 'react'

/** Shared field/section presentation primitives. No pillar logic lives here. */

export const inputClass =
  'w-full rounded-sm border border-rule bg-paper-warm px-3 py-2 text-ink outline-none ' +
  'transition placeholder:text-ink-faint focus:border-accent'

export const kickerClass =
  'font-mono text-[0.7rem] uppercase tracking-[0.16em] text-ink-faint'

export function SectionHead({ num, title }: { num: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-rule pb-2">
      <span className="font-mono text-[0.7rem] tracking-[0.2em] text-accent-ink">{num}</span>
      <h2 className="font-serif text-lg font-normal tracking-tight">{title}</h2>
    </div>
  )
}

export function Field({
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

export function PaceField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (name: 'targetPace', value: string) => void
  error?: string
}) {
  return (
    <Field label="Target pace" hint="mm:ss per km · optional" error={error}>
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

export function SearchProgress() {
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
