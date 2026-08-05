'use client'

import { useState } from 'react'
import type { LatLon } from '@/lib/engine/types'
import { geocodePostcode, PostcodeNotFoundError } from '@/lib/engine/geocode'
import { SectionHead, inputClass } from './fields'

/**
 * Start selection: browser Geolocation with a UK-postcode fallback (decision
 * 12). Owns its own lookup state and reports the resolved point up via
 * `onStartChange` — `null` when a lookup fails, so the shell knows no start is
 * set.
 */
export function StartPoint({ onStartChange }: { onStartChange: (start: LatLon | null) => void }) {
  const [startStatus, setStartStatus] = useState<string | null>(null)
  const [postcode, setPostcode] = useState('')
  const [lookingUp, setLookingUp] = useState(false)

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStartStatus('Location is not available — enter a postcode instead.')
      return
    }
    setStartStatus('Finding your location…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onStartChange({ lat: pos.coords.latitude, lon: pos.coords.longitude })
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
      onStartChange(point)
      setStartStatus(`Start set from ${postcode.trim().toUpperCase()}.`)
    } catch (err) {
      onStartChange(null)
      setStartStatus(
        err instanceof PostcodeNotFoundError
          ? 'Postcode not found — check it and try again.'
          : 'Postcode lookup failed — please try again.',
      )
    } finally {
      setLookingUp(false)
    }
  }

  return (
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
  )
}
