import {
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

import type { LayoutEdgeInput, LayoutNodeInput, LayoutPoint } from "./layout-protocol.ts";

type LayoutNode = SimulationNodeDatum & LayoutNodeInput;

interface LayoutEdge extends SimulationLinkDatum<LayoutNode> {
  source: LayoutNode;
  target: LayoutNode;
}

/** The d3-force state shared by the worker and the no-worker fallback. */
export class LayoutSimulation {
  private nodes: LayoutNode[] = [];
  private byId = new Map<string, LayoutNode>();
  private simulation: Simulation<LayoutNode, LayoutEdge> | null = null;
  private readonly ticked: () => void;

  constructor(ticked: () => void) {
    this.ticked = ticked;
  }

  setData(inputs: LayoutNodeInput[], edgeInputs: LayoutEdgeInput[], alpha: number): void {
    this.simulation?.stop();
    this.nodes = inputs.map((node) => ({
      ...node,
      fx: node.pinned ? node.x : null,
      fy: node.pinned ? node.y : null,
    }));
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    const neighbors = new Map<string, Set<string>>();
    const edges: LayoutEdge[] = [];
    for (const input of edgeInputs) {
      const source = this.byId.get(input.from);
      const target = this.byId.get(input.to);
      if (!source || !target) continue;
      edges.push({ source, target });
      if (!neighbors.has(source.id)) neighbors.set(source.id, new Set());
      if (!neighbors.has(target.id)) neighbors.set(target.id, new Set());
      neighbors.get(source.id)!.add(target.id);
      neighbors.get(target.id)!.add(source.id);
    }
    const degree = (id: string) => Math.max(1, neighbors.get(id)?.size ?? 1);
    const simulation = forceSimulation<LayoutNode, LayoutEdge>(this.nodes)
      .stop()
      .force(
        "link",
        forceLink<LayoutNode, LayoutEdge>(edges)
          .id((node) => node.id)
          .distance((edge) => 46 + edge.source.size + edge.target.size)
          .strength((edge) => 0.7 / Math.min(degree(edge.source.id), degree(edge.target.id))),
      )
      .force("charge", forceManyBody<LayoutNode>().strength((node) => -180 - node.size * 8).distanceMax(700))
      .force("collide", forceCollide<LayoutNode>((node) => node.size + 8).iterations(2))
      .force("x", forceX<LayoutNode>(0).strength(0.035))
      .force("y", forceY<LayoutNode>(0).strength(0.035))
      .alphaDecay(0.028)
      .on("tick", this.ticked);
    this.simulation = simulation;
    simulation.alpha(Math.max(0, alpha));
    if (alpha > 0) simulation.restart();
  }

  drag(points: LayoutPoint[], active: boolean): void {
    for (const point of points) {
      const node = this.byId.get(point.id);
      if (!node) continue;
      node.x = point.x;
      node.y = point.y;
      node.fx = point.x;
      node.fy = point.y;
    }
    this.simulation?.alphaTarget(active ? 0.25 : 0);
    if (active) this.simulation?.restart();
  }

  pin(points: (LayoutPoint & { pinned: boolean })[]): void {
    let released = false;
    for (const point of points) {
      const node = this.byId.get(point.id);
      if (!node) continue;
      node.pinned = point.pinned;
      node.x = point.x;
      node.y = point.y;
      node.fx = point.pinned ? point.x : null;
      node.fy = point.pinned ? point.y : null;
      released ||= !point.pinned;
    }
    if (released && this.simulation) this.simulation.alpha(0.3).restart();
  }

  reheat(): void {
    this.simulation?.alpha(1).restart();
  }

  positions(): Float32Array {
    const positions = new Float32Array(this.nodes.length * 2);
    for (let index = 0; index < this.nodes.length; index++) {
      positions[index * 2] = this.nodes[index].x ?? 0;
      positions[index * 2 + 1] = this.nodes[index].y ?? 0;
    }
    return positions;
  }

  stop(): void {
    this.simulation?.stop();
    this.simulation = null;
  }
}
