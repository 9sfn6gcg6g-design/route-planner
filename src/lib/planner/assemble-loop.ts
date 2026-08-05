import type { LatLon, RunGraph } from '@/lib/engine/types'
import { routeBetween, snapToNode } from '@/lib/engine/route'
import {
  assembleRoute,
  buildWorkGeometry,
  orientStretchToStart,
  rotateRingToNearest,
  type AssembledRoute,
} from '@/lib/engine/assemble'

/** The one work stretch a loop is built around: its geometry and whether it closes. */
export interface LoopStretch {
  points: LatLon[]
  lengthMeters: number
  isCycle: boolean
}

/**
 * Assemble a keyless door-to-door loop around one work stretch (decision 21).
 * Lay the work distance onto the stretch — out-and-back passes on an open
 * stretch, forward laps on a cycle (a hill rep's descent recovery *is* the
 * return pass, so retracing here is intended and not penalised) — then route
 * the runner from the door to where the work starts and back from where it ends,
 * both as quiet paths over the `RunGraph` we already built (no API key). Returns
 * null when the door or either work end can't be reached on the graph, so the
 * caller can fall back to showing the bare stretch.
 */
export function assembleDoorToDoorLoop(
  graph: RunGraph,
  start: LatLon,
  stretch: LoopStretch,
  targetWorkMeters: number,
): AssembledRoute | null {
  const workPoints = stretch.isCycle
    ? rotateRingToNearest(stretch.points, start)
    : orientStretchToStart(stretch.points, start)
  const work = buildWorkGeometry(
    { points: workPoints, lengthMeters: stretch.lengthMeters, isCycle: stretch.isCycle },
    targetWorkMeters,
  )

  const door = snapToNode(graph, start)
  const entryNode = snapToNode(graph, work.points[0])
  const exitNode = snapToNode(graph, work.points[work.points.length - 1])
  if (!door || !entryNode || !exitNode) return null

  const warmup = routeBetween(graph, door.nodeId, entryNode.nodeId)
  const cooldown = routeBetween(graph, exitNode.nodeId, door.nodeId)
  if (!warmup || !cooldown) return null

  return assembleRoute(warmup, work, cooldown)
}
