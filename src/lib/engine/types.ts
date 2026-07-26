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
