import { describe, expect, it } from 'vitest'
import { quietnessFor, surfaceKindFor } from './signals'

describe('quietnessFor', () => {
  it('rates car-free ways quietest', () => {
    expect(quietnessFor({ highway: 'footway' })).toBe(0.9)
    expect(quietnessFor({ highway: 'path' })).toBe(0.9)
    expect(quietnessFor({ highway: 'cycleway' })).toBe(0.9)
    expect(quietnessFor({ highway: 'pedestrian' })).toBe(0.9)
    expect(quietnessFor({ highway: 'track' })).toBe(0.9)
  })

  it('rates residential at exactly the intervals threshold', () => {
    expect(quietnessFor({ highway: 'residential' })).toBe(0.7)
  })

  it('rates busier road classes progressively lower', () => {
    const order = ['living_street', 'residential', 'service', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk']
    const scores = order.map((h) => quietnessFor({ highway: h }))
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
    }
    expect(quietnessFor({ highway: 'trunk' })).toBe(0.1)
  })

  it('defaults unknown highway values to a low-mid score', () => {
    expect(quietnessFor({ highway: 'road' })).toBe(0.5)
    expect(quietnessFor({})).toBe(0.5)
  })
})

describe('surfaceKindFor', () => {
  it('maps explicit paved surfaces', () => {
    expect(surfaceKindFor({ surface: 'asphalt' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'paving_stones' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'concrete' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'paved' })).toBe('paved')
    expect(surfaceKindFor({ surface: 'sett' })).toBe('paved')
  })

  it('maps explicit unpaved surfaces', () => {
    for (const s of ['gravel', 'dirt', 'grass', 'ground', 'unpaved', 'sand', 'mud', 'fine_gravel', 'compacted', 'earth', 'wood']) {
      expect(surfaceKindFor({ surface: s })).toBe('unpaved')
    }
  })

  it('infers pavement from highway class when surface is missing', () => {
    expect(surfaceKindFor({ highway: 'residential' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'pedestrian' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'cycleway' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'path' })).toBe('unpaved')
    expect(surfaceKindFor({ highway: 'track' })).toBe('unpaved')
  })

  it('returns unknown when neither surface nor a known highway is present', () => {
    expect(surfaceKindFor({})).toBe('unknown')
    expect(surfaceKindFor({ surface: 'weird_value' })).toBe('unknown')
  })

  it('prefers the explicit surface tag over highway inference', () => {
    expect(surfaceKindFor({ highway: 'path', surface: 'asphalt' })).toBe('paved')
    expect(surfaceKindFor({ highway: 'residential', surface: 'gravel' })).toBe('unpaved')
  })
})
