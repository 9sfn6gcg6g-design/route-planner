import { describe, expect, it } from 'vitest'
import type { Session } from '@/lib/domain/types'
import {
  formatGradient,
  formatKm,
  formatPercent01,
  gpxFileName,
  sessionSummary,
} from './format'

const easy: Session = { type: 'easy', distanceMeters: 8000 }
const tempo: Session = { type: 'tempo', tempoMeters: 5000 }
const intervals: Session = { type: 'intervals', reps: 6, repMeters: 800, recovery: 'static' }
const hills: Session = { type: 'hills', reps: 8, hillMeters: 150 }

describe('sessionSummary', () => {
  it('reads naturally per session type', () => {
    expect(sessionSummary(easy)).toBe('Easy 8.0 km')
    expect(sessionSummary(tempo)).toBe('Tempo 5.0 km')
    expect(sessionSummary(intervals)).toBe('6 × 800m intervals (static recovery)')
    expect(sessionSummary(hills)).toBe('8 × 150m hills')
  })
})

describe('gpxFileName', () => {
  it('is a safe, descriptive filename per session type', () => {
    expect(gpxFileName(easy)).toBe('route-easy-8km.gpx')
    expect(gpxFileName(tempo)).toBe('route-tempo-5km.gpx')
    expect(gpxFileName(intervals)).toBe('route-6x800m-intervals.gpx')
    expect(gpxFileName(hills)).toBe('route-8x150m-hills.gpx')
  })
})

describe('number formatters', () => {
  it('formats km to one decimal', () => {
    expect(formatKm(8000)).toBe('8.0 km')
    expect(formatKm(1234)).toBe('1.2 km')
  })

  it('formats a 0–1 score as a percentage', () => {
    expect(formatPercent01(0.9)).toBe('90%')
    expect(formatPercent01(0.7)).toBe('70%')
  })

  it('formats gradient to one decimal percent', () => {
    expect(formatGradient(0)).toBe('0.0%')
    expect(formatGradient(3.42)).toBe('3.4%')
  })
})
