import { describe, expect, it } from 'vitest'
import type { LatLon } from '@/lib/engine/types'
import type { ElevationSampler } from '@/lib/engine/finder'
import { createDefaultElevationSampler } from './default-elevation-sampler'

const points: LatLon[] = [{ lat: 51.45, lon: -2.6 }]

/** A fake provider that records the order it is consulted in. */
function provider(order: string[], name: string, behavior: 'ok' | 'throw'): ElevationSampler {
  return async (pts: LatLon[]): Promise<number[]> => {
    order.push(name)
    if (behavior === 'throw') throw new Error(name)
    return pts.map(() => 1)
  }
}

describe('createDefaultElevationSampler', () => {
  it('tries terrarium first and stops on its success', async () => {
    const order: string[] = []
    const sampler = createDefaultElevationSampler({
      terrarium: provider(order, 'terrarium', 'ok'),
      openElevation: provider(order, 'openElevation', 'ok'),
      openMeteo: provider(order, 'openMeteo', 'ok'),
    })
    await sampler(points)
    expect(order).toEqual(['terrarium'])
  })

  it('falls over to Open-Elevation when terrarium throws', async () => {
    const order: string[] = []
    const sampler = createDefaultElevationSampler({
      terrarium: provider(order, 'terrarium', 'throw'),
      openElevation: provider(order, 'openElevation', 'ok'),
      openMeteo: provider(order, 'openMeteo', 'ok'),
    })
    await sampler(points)
    expect(order).toEqual(['terrarium', 'openElevation'])
  })

  it('falls over to Open-Meteo only when both keyless providers throw', async () => {
    const order: string[] = []
    const sampler = createDefaultElevationSampler({
      terrarium: provider(order, 'terrarium', 'throw'),
      openElevation: provider(order, 'openElevation', 'throw'),
      openMeteo: provider(order, 'openMeteo', 'ok'),
    })
    await sampler(points)
    expect(order).toEqual(['terrarium', 'openElevation', 'openMeteo'])
  })

  it('rejects when every provider throws', async () => {
    const order: string[] = []
    const sampler = createDefaultElevationSampler({
      terrarium: provider(order, 'terrarium', 'throw'),
      openElevation: provider(order, 'openElevation', 'throw'),
      openMeteo: provider(order, 'openMeteo', 'throw'),
    })
    await expect(sampler(points)).rejects.toThrow()
    expect(order).toEqual(['terrarium', 'openElevation', 'openMeteo'])
  })
})
