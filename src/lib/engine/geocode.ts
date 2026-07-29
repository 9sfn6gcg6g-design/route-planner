import type { LatLon } from './types'

const POSTCODES_ENDPOINT = 'https://api.postcodes.io/postcodes'

export function buildPostcodeUrl(postcode: string): string {
  return `${POSTCODES_ENDPOINT}/${encodeURIComponent(postcode.trim())}`
}

interface PostcodesResponse {
  result?: { latitude?: number; longitude?: number } | null
}

/** Postcode not found, or a malformed body. Surface to the user as-is. */
export class PostcodeNotFoundError extends Error {}

export function parsePostcodeResponse(body: unknown): LatLon {
  if (typeof body !== 'object' || body === null) {
    throw new PostcodeNotFoundError('postcode lookup returned no result')
  }
  const result = (body as PostcodesResponse).result
  if (
    !result ||
    typeof result.latitude !== 'number' ||
    typeof result.longitude !== 'number'
  ) {
    throw new PostcodeNotFoundError('postcode lookup returned no result')
  }
  return { lat: result.latitude, lon: result.longitude }
}

/**
 * I/O glue — composition of tested parts; not unit-tested. Resolves a UK
 * postcode to a start point via postcodes.io (keyless, CORS-enabled, so it
 * runs from the browser on the static host).
 */
export async function geocodePostcode(postcode: string): Promise<LatLon> {
  const response = await fetch(buildPostcodeUrl(postcode))
  if (response.status === 404) {
    throw new PostcodeNotFoundError(`postcode not found: ${postcode}`)
  }
  if (!response.ok) {
    throw new Error(`postcode lookup failed: ${response.status}`)
  }
  return parsePostcodeResponse(await response.json())
}
