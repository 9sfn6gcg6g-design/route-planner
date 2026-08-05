import { describe, expect, it } from 'vitest'
import type { Session } from '@/lib/domain/types'
import {
  crossingCaveat,
  formatGradient,
  formatKm,
  formatPace,
  formatPercent01,
  formatQuality,
  gpxFileName,
  sessionSummary,
  sessionTargetPace,
} from './format'

const easy: Session = { type: 'easy', distanceMeters: 8000 }
const tempo: Session = {
  type: 'tempo',
  reps: 1,
  tempoMeters: 5000,
  recovery: 'jog',
  targetPaceSecondsPerKm: 300,
}
const tempoReps: Session = {
  type: 'tempo',
  reps: 3,
  tempoMeters: 2000,
  recovery: 'jog',
  targetPaceSecondsPerKm: 285,
}
const intervals: Session = {
  type: 'intervals',
  reps: 6,
  repMeters: 800,
  recovery: 'static',
  targetPaceSecondsPerKm: 270,
}
const hills: Session = {
  type: 'hills',
  reps: 8,
  hillMeters: 150,
  targetPaceSecondsPerKm: 300,
}

describe('sessionSummary', () => {
  it('reads naturally per session type', () => {
    expect(sessionSummary(easy)).toBe('Easy 8.0 km')
    expect(sessionSummary(tempo)).toBe('Tempo 5.0 km')
    expect(sessionSummary(tempoReps)).toBe('3 × 2.0 km tempo')
    expect(sessionSummary(intervals)).toBe('6 × 800m intervals (static recovery)')
    expect(sessionSummary(hills)).toBe('8 × 150m hills')
  })
})

describe('gpxFileName', () => {
  it('is a safe, descriptive filename per session type', () => {
    expect(gpxFileName(easy)).toBe('route-easy-8km.gpx')
    expect(gpxFileName(tempo)).toBe('route-tempo-5km.gpx')
    expect(gpxFileName(tempoReps)).toBe('route-3x2km-tempo.gpx')
    expect(gpxFileName(intervals)).toBe('route-6x800m-intervals.gpx')
    expect(gpxFileName(hills)).toBe('route-8x150m-hills.gpx')
  })
})

describe('sessionTargetPace', () => {
  it('is null for conversational easy/long sessions', () => {
    expect(sessionTargetPace(easy)).toBeNull()
  })

  it('reads the target pace off a structured session that carries one', () => {
    expect(sessionTargetPace(tempo)).toBe(300)
    expect(sessionTargetPace(intervals)).toBe(270)
  })

  it('is null when a structured session omits the pace (decision 17)', () => {
    const noPace: Session = { type: 'tempo', reps: 1, tempoMeters: 5000, recovery: 'jog' }
    expect(sessionTargetPace(noPace)).toBeNull()
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

  it('formats a target pace (seconds/km) as mm:ss/km', () => {
    expect(formatPace(300)).toBe('5:00/km')
    expect(formatPace(310)).toBe('5:10/km')
    expect(formatPace(285)).toBe('4:45/km')
  })

  it('caveats road crossings, and stays silent when crossing-free', () => {
    expect(crossingCaveat(0)).toBeNull()
    expect(crossingCaveat(1)).toBe('Crosses 1 road')
    expect(crossingCaveat(3)).toBe('Crosses 3 roads')
  })

  it('formats a 0–1 quality score as a percentage', () => {
    expect(formatQuality(0.87)).toBe('87%')
    expect(formatQuality(1)).toBe('100%')
  })
})
