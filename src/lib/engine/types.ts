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
}
