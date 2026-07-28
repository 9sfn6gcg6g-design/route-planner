export interface LatLon {
  lat: number
  lon: number
}

/** One OSM way as returned by Overpass `out geom`, filtered to what we use. */
export interface OsmWay {
  id: number
  tags: Record<string, string>
  nodeIds: number[]
  points: LatLon[]
}

export type SurfaceKind = 'paved' | 'unpaved' | 'unknown'

/** A junction-to-junction slice of an OSM way, annotated with signals. */
export interface RunEdge {
  wayId: number
  fromNodeId: number
  toNodeId: number
  points: LatLon[]
  lengthMeters: number
  highway: string
  quietness: number
  surface: SurfaceKind
}

export interface RunGraph {
  edges: RunEdge[]
  junctionNodeIds: Set<number>
  /**
   * Edge-degree per node: how many emitted edges touch that node (an edge
   * contributes +1 to both its `fromNodeId` and its `toNodeId`). Nodes with
   * degree >= 3 are true crossings; degree-2 nodes are splices where a way
   * was split without any real branching. See buildGraph's doc comment.
   */
  nodeDegree: Map<number, number>
}

/**
 * A maximal uninterrupted stretch: graph edges merged through degree-2
 * splice nodes, terminating only at true crossings (degree >= 3), dead
 * ends (degree 1), or — for isolated loops like a park circuit — closing
 * back on the start (isCycle).
 */
export interface Chain {
  edges: RunEdge[]
  points: LatLon[]
  lengthMeters: number
  startNodeId: number
  endNodeId: number
  isCycle: boolean
}
