export interface LayoutNodeInput {
  id: string;
  size: number;
  x: number;
  y: number;
  pinned: boolean;
}

export interface LayoutEdgeInput {
  from: string;
  to: string;
}

export interface LayoutPoint {
  id: string;
  x: number;
  y: number;
}

export type LayoutRequest =
  | { type: "setData"; generation: number; nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[]; alpha: number }
  | { type: "drag"; points: LayoutPoint[]; active: boolean }
  | { type: "pin"; points: (LayoutPoint & { pinned: boolean })[] }
  | { type: "reheat" }
  | { type: "stop" };

export interface LayoutPositions {
  type: "positions";
  generation: number;
  positions: Float32Array;
}

export type LayoutResponse = LayoutPositions;
