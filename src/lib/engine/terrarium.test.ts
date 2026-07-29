import { describe, expect, it } from 'vitest'
import {
  TILE_SIZE,
  decodeTerrariumElevation,
  tileCoordsFor,
  sampleGrid,
  createTerrariumSampler,
  type TileGrid,
} from './terrarium'

describe('decodeTerrariumElevation', () => {
  it('decodes the terrarium RGB encoding (R*256 + G + B/256 - 32768)', () => {
    // 0m sea level encodes as R=128, G=0, B=0
    expect(decodeTerrariumElevation(128, 0, 0)).toBe(0)
    // 8m: R=128, G=8, B=0
    expect(decodeTerrariumElevation(128, 8, 0)).toBe(8)
    // -1m: R=127, G=255, B=0
    expect(decodeTerrariumElevation(127, 255, 0)).toBe(-1)
    // fractional metres come from the blue channel
    expect(decodeTerrariumElevation(128, 8, 128)).toBe(8.5)
  })
})

describe('tileCoordsFor', () => {
  it('maps central Bristol to the known z13 tile with in-tile pixel position', () => {
    // Independently computed: 51.4545,-2.5879 falls in tile 13/4037/2725
    const c = tileCoordsFor({ lat: 51.4545, lon: -2.5879 }, 13)
    expect(c.z).toBe(13)
    expect(c.x).toBe(4037)
    expect(c.y).toBe(2725)
    expect(c.px).toBeGreaterThanOrEqual(0)
    expect(c.px).toBeLessThan(TILE_SIZE)
    expect(c.py).toBeGreaterThanOrEqual(0)
    expect(c.py).toBeLessThan(TILE_SIZE)
  })

  it('puts a point on the west edge of a tile at a small px', () => {
    // Tile x spans 360/2^13 degrees; a point just east of the tile boundary
    const tileWidthDeg = 360 / 2 ** 13
    const westEdgeLon = 4037 * tileWidthDeg - 180
    const c = tileCoordsFor({ lat: 51.4545, lon: westEdgeLon + tileWidthDeg / 512 }, 13)
    expect(c.x).toBe(4037)
    expect(c.px).toBeCloseTo(0.5, 5)
  })
})

const uniformGrid = (elevation: number): TileGrid => ({
  elevations: new Float64Array(TILE_SIZE * TILE_SIZE).fill(elevation),
})

describe('sampleGrid', () => {
  it('returns the pixel value on a uniform grid', () => {
    expect(sampleGrid(uniformGrid(42), 10.3, 200.7)).toBe(42)
  })

  it('interpolates bilinearly between neighbouring pixels', () => {
    const elevations = new Float64Array(TILE_SIZE * TILE_SIZE)
    // row 0: pixel (0,0)=0, (1,0)=10; row 1: (0,1)=20, (1,1)=30
    elevations[0] = 0
    elevations[1] = 10
    elevations[TILE_SIZE] = 20
    elevations[TILE_SIZE + 1] = 30
    // sampling at pixel centres (0.5, 0.5) lands exactly on pixel (0,0)
    expect(sampleGrid({ elevations }, 0.5, 0.5)).toBe(0)
    // halfway between the four centres blends all four equally
    expect(sampleGrid({ elevations }, 1.0, 1.0)).toBe(15)
  })

  it('clamps sampling at tile edges instead of reading out of bounds', () => {
    expect(sampleGrid(uniformGrid(7), -3, TILE_SIZE + 5)).toBe(7)
  })
})

describe('createTerrariumSampler', () => {
  it('samples every point and fetches each tile only once', async () => {
    const loads: string[] = []
    const sampler = createTerrariumSampler(async (tile) => {
      loads.push(`${tile.z}/${tile.x}/${tile.y}`)
      return uniformGrid(100)
    }, 13)

    // two points in the same Bristol tile, one in the neighbouring tile east
    const tileWidthDeg = 360 / 2 ** 13
    const result = await sampler([
      { lat: 51.4545, lon: -2.5879 },
      { lat: 51.455, lon: -2.588 },
      { lat: 51.4545, lon: -2.5879 + tileWidthDeg },
    ])

    expect(result).toEqual([100, 100, 100])
    expect(loads.sort()).toEqual(['13/4037/2725', '13/4038/2725'])
  })

  it('returns elevations in input order across tiles', async () => {
    const tileWidthDeg = 360 / 2 ** 13
    const sampler = createTerrariumSampler(
      async (tile) => uniformGrid(tile.x === 4037 ? 5 : 50),
      13,
    )
    const result = await sampler([
      { lat: 51.4545, lon: -2.5879 + tileWidthDeg }, // east tile → 50
      { lat: 51.4545, lon: -2.5879 }, // home tile → 5
    ])
    expect(result).toEqual([50, 5])
  })

  it('reuses the cache across calls', async () => {
    let loads = 0
    const sampler = createTerrariumSampler(async () => {
      loads += 1
      return uniformGrid(1)
    }, 13)
    await sampler([{ lat: 51.4545, lon: -2.5879 }])
    await sampler([{ lat: 51.4546, lon: -2.588 }])
    expect(loads).toBe(1)
  })

  it('propagates a tile-load failure so callers can fail over', async () => {
    const sampler = createTerrariumSampler(async () => {
      throw new Error('tile fetch failed')
    }, 13)
    await expect(sampler([{ lat: 51.4545, lon: -2.5879 }])).rejects.toThrow(/tile fetch failed/)
  })

  it('returns an empty array for no points without loading tiles', async () => {
    let loads = 0
    const sampler = createTerrariumSampler(async () => {
      loads += 1
      return uniformGrid(0)
    }, 13)
    expect(await sampler([])).toEqual([])
    expect(loads).toBe(0)
  })
})
