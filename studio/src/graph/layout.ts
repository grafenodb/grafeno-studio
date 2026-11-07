import type { LayoutEdgeInput, LayoutNodeInput, LayoutPoint, LayoutRequest, LayoutResponse } from "./layout-protocol.ts";
import { LayoutSimulation } from "./layout-simulation.ts";

type Data = { generation: number; nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[]; alpha: number };
export type LayoutMode = "worker" | "main";

/** Runs layout in a module worker, falling back to the main thread if needed. */
export class GraphLayout {
  private worker: Worker | null = null;
  private fallback: LayoutSimulation | null = null;
  private generation = 0;
  private data: Data | null = null;
  private scheduled: number | null = null;
  private stopped = false;
  private readonly moved: (positions: Float32Array) => void;
  private readonly modeChanged: (mode: LayoutMode) => void;

  constructor(moved: (positions: Float32Array) => void, modeChanged: (mode: LayoutMode) => void = () => undefined) {
    this.moved = moved;
    this.modeChanged = modeChanged;
    if (typeof Worker === "undefined") {
      this.startFallback();
      return;
    }
    try {
      const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
        if (event.data.type === "positions" && event.data.generation === this.generation) this.acceptPositions(event.data.positions);
      };
      worker.onerror = () => this.startFallback();
      worker.onmessageerror = () => this.startFallback();
      this.worker = worker;
      this.modeChanged("worker");
    } catch {
      this.startFallback();
    }
  }

  setData(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], alpha: number): void {
    const generation = ++this.generation;
    this.data = { generation, nodes: nodes.map((node) => ({ ...node })), edges: edges.map((edge) => ({ ...edge })), alpha };
    if (this.worker) this.post({ type: "setData", ...this.data });
    else this.setFallbackData();
  }

  drag(points: LayoutPoint[], active: boolean): void {
    this.updatePoints(points);
    if (this.worker) this.post({ type: "drag", points, active });
    else this.fallback?.drag(points, active);
  }

  pin(points: (LayoutPoint & { pinned: boolean })[]): void {
    this.updatePoints(points);
    if (this.data) {
      const pinned = new Map(points.map((point) => [point.id, point.pinned]));
      for (const node of this.data.nodes) if (pinned.has(node.id)) node.pinned = pinned.get(node.id)!;
    }
    if (this.worker) this.post({ type: "pin", points });
    else this.fallback?.pin(points);
  }

  reheat(): void {
    if (this.worker) this.post({ type: "reheat" });
    else this.fallback?.reheat();
  }

  stop(): void {
    this.stopped = true;
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "stop" } satisfies LayoutRequest);
      } catch {
        // A worker that already failed still needs to be terminated below.
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.fallback?.stop();
    this.fallback = null;
    if (this.scheduled !== null) this.cancelScheduled(this.scheduled);
    this.scheduled = null;
  }

  private post(message: LayoutRequest): void {
    try {
      this.worker?.postMessage(message);
    } catch {
      this.startFallback();
    }
  }

  private startFallback(): void {
    if (this.stopped || this.fallback) return;
    this.worker?.terminate();
    this.worker = null;
    this.fallback = new LayoutSimulation(() => this.scheduleFallbackPositions());
    this.modeChanged("main");
    this.setFallbackData();
  }

  private setFallbackData(): void {
    if (!this.fallback || !this.data) return;
    this.fallback.setData(this.data.nodes, this.data.edges, this.data.alpha);
    if (this.data.alpha <= 0) this.scheduleFallbackPositions();
  }

  private scheduleFallbackPositions(): void {
    if (this.scheduled !== null || !this.fallback) return;
    const send = () => {
      this.scheduled = null;
      if (this.fallback) this.acceptPositions(this.fallback.positions());
    };
    this.scheduled =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(send)
        : (setTimeout(send, 16) as unknown as number);
  }

  private cancelScheduled(handle: number): void {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    else clearTimeout(handle);
  }

  private updatePoints(points: LayoutPoint[]): void {
    if (!this.data) return;
    const updates = new Map(points.map((point) => [point.id, point]));
    for (const node of this.data.nodes) {
      const point = updates.get(node.id);
      if (point) Object.assign(node, { x: point.x, y: point.y });
    }
  }

  private acceptPositions(positions: Float32Array): void {
    if (this.data && positions.length === this.data.nodes.length * 2) {
      for (let index = 0; index < this.data.nodes.length; index++) {
        this.data.nodes[index].x = positions[index * 2];
        this.data.nodes[index].y = positions[index * 2 + 1];
      }
    }
    this.moved(positions);
  }
}
