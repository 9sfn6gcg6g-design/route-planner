import type { LatLon } from './types'
import type { ElevationSampler } from './finder'

/**
 * Elevation sampling from AWS Open Data terrain tiles (Mapzen "terrarium"
 * encoding): keyless, CORS-open, and effectively unmetered — one search area
 * is a handful of 256px PNG tiles fetched once and sampled locally, instead
 * of hundreds of quota-weighted API coordinates per attempt.
 * https://registry.opendata.aws/terrain-tiles/
 */
const TERRARIUM_ENDPOINT = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium'

export const TILE_SIZE = 256

/** ~12m/pixel ground resolution at UK latitudes — finer than the ~30m source data. */
export const DEFAULT_ZOOM = 13

export interface TileKey {
  z: number
  x: number
  y: number
}

/** A decoded tile: TILE_SIZE × TILE_SIZE elevations in metres, row-major. */
export interface TileGrid {
  elevations: Float64Array
}

export interface TileCoords extends TileKey {
  /** Position within the tile, in pixels from its top-left corner. */
  px: number
  py: number
}

/** Terrarium PNG encoding: elevation = R*256 + G + B/256 − 32768 metres. */
export function decodeTerrariumElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

/** Web-mercator tile containing `point` at `zoom`, with in-tile pixel position. */
export function tileCoordsFor(point: LatLon, zoom: number): TileCoords {
  const scale = 2 ** zoom
  const worldX = ((point.lon + 180) / 360) * scale
  const latRad = (point.lat * Math.PI) / 180
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  const x = Math.floor(worldX)
  const y = Math.floor(worldY)
  return {
    z: zoom,
    x,
    y,
    px: (worldX - x) * TILE_SIZE,
    py: (worldY - y) * TILE_SIZE,
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Bilinear sample at a fractional pixel position. Sampling is clamped to the
 * tile, so points within half a pixel of an edge lose cross-tile blending —
 * negligible at ~12m/pixel against ~30m source data.
 */
export function sampleGrid(grid: TileGrid, px: number, py: number): number {
  const gx = clamp(px - 0.5, 0, TILE_SIZE - 1)
  const gy = clamp(py - 0.5, 0, TILE_SIZE - 1)
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(x0 + 1, TILE_SIZE - 1)
  const y1 = Math.min(y0 + 1, TILE_SIZE - 1)
  const fx = gx - x0
  const fy = gy - y0
  const at = (x: number, y: number) => grid.elevations[y * TILE_SIZE + x]
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
  return top * (1 - fy) + bottom * fy
}

export type TileLoader = (tile: TileKey) => Promise<TileGrid>

/**
 * Build an ElevationSampler over terrain tiles. Tiles are fetched through
 * `loadTile` and cached (as promises, so concurrent requests for one tile
 * dedupe) for the sampler's lifetime — elevation data never changes.
 */
export function createTerrariumSampler(
  loadTile: TileLoader,
  zoom: number = DEFAULT_ZOOM,
): ElevationSampler {
  const cache = new Map<string, Promise<TileGrid>>()

  const tileFor = (key: TileKey): Promise<TileGrid> => {
    const id = `${key.z}/${key.x}/${key.y}`
    let tile = cache.get(id)
    if (!tile) {
      tile = loadTile(key)
      cache.set(id, tile)
    }
    return tile
  }

  return async (points: LatLon[]): Promise<number[]> => {
    if (points.length === 0) return []
    const coords = points.map((point) => tileCoordsFor(point, zoom))
    const grids = await Promise.all(
      coords.map(({ z, x, y }) => tileFor({ z, x, y })),
    )
    return coords.map((c, i) => sampleGrid(grids[i], c.px, c.py))
  }
}

/** I/O glue — browser-only PNG decode via canvas; not unit-tested. */
export async function fetchTerrariumTile(tile: TileKey): Promise<TileGrid> {
  const response = await fetch(`${TERRARIUM_ENDPOINT}/${tile.z}/${tile.x}/${tile.y}.png`)
  if (!response.ok) {
    throw new Error(`terrain tile request failed: ${response.status}`)
  }
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('terrain tile decode failed: no 2d context')
  context.drawImage(bitmap, 0, 0)
  const { data } = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
  const elevations = new Float64Array(TILE_SIZE * TILE_SIZE)
  for (let i = 0; i < elevations.length; i++) {
    elevations[i] = decodeTerrariumElevation(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
  }
  return { elevations }
}
