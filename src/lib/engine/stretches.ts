import type { Chain, LatLon, RunEdge, RunGraph } from './types'
import { buildChains } from './chains'
import { chainMinQuietness } from './evaluate'
import { bearingDegrees, classifyTurn, signedTurnDegrees } from './geo'

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
  /** Signed heading change taken at each junction the assembly extended through
   *  (decision 18), for scoring turn-smoothness and turn-density. Empty when the
   *  corridor was returned unextended. */
  turnAngles: number[]
}

export interface AssembleOptions {
  /** Stop extending once a stretch reaches this length (meters). Default 0 —
   *  no extension, so each corridor is returned unchanged (crossings 0). */
  targetMeters?: number
  /** Hard cap on corridors stitched into one stretch, guarding runaway walks. */
  maxHops?: number
}

/** Sort key for the left-before-right tiebreak: left (anticlockwise) sorts first. */
const turnSide = (signed: number): number => (signed < 0 ? 0 : 1)

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
  const { targetMeters = 0, maxHops = 12 } = options
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
      stretches.push({ chain: seed, crossings: 0, turnAngles: [] })
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
    const turnAngles: number[] = []

    for (let hop = 0; lengthMeters < targetMeters && hop < maxHops; hop++) {
      const candidates = (incidence.get(node) ?? [])
        .filter((chain) => !visited.has(chain))
        .map((chain) => {
          const oriented = orientedFromNode(chain, node)
          const departure = firstBearing(oriented.points)
          const turn = classifyTurn(arrivalBearing, departure)
          return {
            chain,
            oriented,
            signed: signedTurnDegrees(arrivalBearing, departure),
            isCrossing: turn === 'straight',
            isBack: turn === 'back',
            quietness: chainMinQuietness(chain),
          }
        })
        .filter((candidate) => !candidate.isBack)
      if (candidates.length === 0) break

      // Decision 18: prefer the gentlest non-crossing continuation. Turns beat a
      // straight-across crossing; among turns the gentler wins; left-before-right
      // only breaks a tie between equally sharp turns (nearside without crossing
      // the carriageway). Quietness then corridorKey keep it deterministic.
      candidates.sort(
        (a, b) =>
          Number(a.isCrossing) - Number(b.isCrossing) ||
          Math.abs(a.signed) - Math.abs(b.signed) ||
          turnSide(a.signed) - turnSide(b.signed) ||
          b.quietness - a.quietness ||
          corridorKey(a.chain).localeCompare(corridorKey(b.chain)),
      )
      const chosen = candidates[0]
      if (chosen.isCrossing) crossings++
      turnAngles.push(chosen.signed)

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
      turnAngles,
    })
  }

  return stretches
}
