import type { Chain, LatLon, RunEdge, RunGraph } from './types'
import { buildChains } from './chains'
import { chainMinQuietness } from './evaluate'
import { bearingDegrees, classifyTurn, type TurnClass } from './geo'

/**
 * A work stretch assembled from corridor chains (decision 15). Where a plain
 * corridor terminates at a junction, we stitch on the next corridor —
 * preferring a left turn, then a right, then going straight across — so a
 * stretch may turn instead of ending. Turns are free; a straight-across is a
 * road crossing and is tallied so results can be caveated rather than dropped.
 */
export interface Stretch {
  chain: Chain
  /** Straight-across junctions traversed while assembling: the forced road
   *  crossings the runner would face. Turns contribute nothing. */
  crossings: number
}

export interface AssembleOptions {
  /** Stop extending once a stretch reaches this length (meters). Default 0 —
   *  no extension, so each corridor is returned unchanged (crossings 0). */
  targetMeters?: number
  /** Hard cap on corridors stitched into one stretch, guarding runaway walks. */
  maxHops?: number
  /** Continuation rule. 'turns' (decision 15, default) prefers left > right >
   *  straight to dodge crossings — right for work stretches. 'flow' (decision
   *  17, conversational) prefers the quietest sustained corridor, discounting
   *  slivers, so a stretch follows a fragmented waterfront instead of turning
   *  off it; crossings are still tallied for the caveat. */
  continuation?: 'turns' | 'flow'
}

/** Below this length a corridor's quietness is discounted proportionally under
 *  'flow', so an 11m sliver never outranks a real continuation. */
const FLOW_SUSTAIN_METERS = 200

const flowScore = (quietness: number, chain: Chain): number =>
  quietness * Math.min(1, chain.lengthMeters / FLOW_SUSTAIN_METERS)

/** Continuation preference: a left turn beats a right, a right beats straight. */
const CLASS_RANK: Record<TurnClass, number> = { left: 0, right: 1, straight: 2, back: 3 }

const firstBearing = (points: LatLon[]): number => bearingDegrees(points[0], points[1])
const lastBearing = (points: LatLon[]): number =>
  bearingDegrees(points[points.length - 2], points[points.length - 1])

/** Orient a corridor to depart from `node`, without mutating it. */
function orientedFromNode(
  chain: Chain,
  node: number,
): { points: LatLon[]; edges: RunEdge[]; endNode: number } {
  if (chain.startNodeId === node) {
    return { points: chain.points, edges: chain.edges, endNode: chain.endNodeId }
  }
  return {
    points: [...chain.points].reverse(),
    edges: [...chain.edges].reverse(),
    endNode: chain.startNodeId,
  }
}

/** A stable, input-order-independent key so ties break deterministically. */
function corridorKey(chain: Chain): string {
  return `${chain.edges[0].wayId}:${chain.startNodeId}:${chain.endNodeId}`
}

/**
 * Build work stretches from a graph: corridors (buildChains) extended across
 * junctions by turn preference. Cycles are returned as-is. Every non-cycle
 * corridor seeds one greedy, deterministic extension from its far end — the
 * selection depends only on topology and signals, never on input order.
 */
export function assembleStretches(graph: RunGraph, options: AssembleOptions = {}): Stretch[] {
  const { targetMeters = 0, maxHops = 12, continuation = 'turns' } = options
  const corridors = buildChains(graph)

  const incidence = new Map<number, Chain[]>()
  const addIncidence = (node: number, chain: Chain): void => {
    const list = incidence.get(node)
    if (list) list.push(chain)
    else incidence.set(node, [chain])
  }
  for (const chain of corridors) {
    if (chain.isCycle) continue
    addIncidence(chain.startNodeId, chain)
    addIncidence(chain.endNodeId, chain)
  }

  const stretches: Stretch[] = []
  for (const seed of corridors) {
    if (seed.isCycle) {
      stretches.push({ chain: seed, crossings: 0 })
      continue
    }

    const points: LatLon[] = [...seed.points]
    const edges: RunEdge[] = [...seed.edges]
    const tolerated: number[] = [...seed.toleratedJunctionNodeIds]
    const visited = new Set<Chain>([seed])
    let lengthMeters = seed.lengthMeters
    let node = seed.endNodeId
    let arrivalBearing = lastBearing(seed.points)
    let crossings = 0

    for (let hop = 0; lengthMeters < targetMeters && hop < maxHops; hop++) {
      const candidates = (incidence.get(node) ?? [])
        .filter((chain) => !visited.has(chain))
        .map((chain) => {
          const oriented = orientedFromNode(chain, node)
          return {
            chain,
            oriented,
            turn: classifyTurn(arrivalBearing, firstBearing(oriented.points)),
            quietness: chainMinQuietness(chain),
          }
        })
        .filter((candidate) => candidate.turn !== 'back')
      if (candidates.length === 0) break

      candidates.sort((a, b) =>
        continuation === 'flow'
          ? flowScore(b.quietness, b.chain) - flowScore(a.quietness, a.chain) ||
            CLASS_RANK[a.turn] - CLASS_RANK[b.turn] ||
            corridorKey(a.chain).localeCompare(corridorKey(b.chain))
          : CLASS_RANK[a.turn] - CLASS_RANK[b.turn] ||
            b.quietness - a.quietness ||
            corridorKey(a.chain).localeCompare(corridorKey(b.chain)),
      )
      const chosen = candidates[0]
      if (chosen.turn === 'straight') crossings++

      points.push(...chosen.oriented.points.slice(1))
      edges.push(...chosen.oriented.edges)
      tolerated.push(...chosen.chain.toleratedJunctionNodeIds)
      lengthMeters += chosen.chain.lengthMeters
      visited.add(chosen.chain)
      node = chosen.oriented.endNode
      arrivalBearing = lastBearing(chosen.oriented.points)
    }

    stretches.push({
      chain: {
        edges,
        points,
        lengthMeters,
        startNodeId: seed.startNodeId,
        endNodeId: node,
        isCycle: false,
        toleratedJunctionNodeIds: tolerated,
      },
      crossings,
    })
  }

  return stretches
}
