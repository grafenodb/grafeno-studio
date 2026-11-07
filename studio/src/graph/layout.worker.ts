import type { LayoutEdgeInput, LayoutNodeInput, LayoutRequest, LayoutResponse } from "./layout-protocol.ts";
import { LayoutSimulation } from "./layout-simulation.ts";
import { usesWebGPU, WebGPULayout } from "./webgpu-layout.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let generation = 0;
let token = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let gpu: WebGPULayout | null = null;
let currentNodes: LayoutNodeInput[] = [];
let currentById = new Map<string, LayoutNodeInput>();
let currentEdges: LayoutEdgeInput[] = [];
let currentAlpha = 0;
const cpu = new LayoutSimulation(scheduleCpuPositions);

function publish(positions: Float32Array): void {
  if (positions.length === currentNodes.length * 2) {
    for (let index = 0; index < currentNodes.length; index++) {
      currentNodes[index].x = positions[index * 2];
      currentNodes[index].y = positions[index * 2 + 1];
    }
  }
  scope.postMessage({ type: "positions", generation, positions }, [positions.buffer]);
}

function backend(value: "worker" | "webgpu"): void {
  scope.postMessage({ type: "backend", generation, backend: value });
}

function scheduleCpuPositions(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    publish(cpu.positions());
  }, 16);
}

function startCpu(expectedToken = token): void {
  if (expectedToken !== token) return;
  gpu?.stop();
  gpu = null;
  cpu.setData(currentNodes, currentEdges, currentAlpha);
  backend("worker");
  if (currentAlpha <= 0) scheduleCpuPositions();
}

async function setData(message: Extract<LayoutRequest, { type: "setData" }>): Promise<void> {
  const expectedToken = ++token;
  generation = message.generation;
  currentNodes = message.nodes.map((node) => ({ ...node }));
  currentById = new Map(currentNodes.map((node) => [node.id, node]));
  currentEdges = message.edges.map((edge) => ({ ...edge }));
  currentAlpha = message.alpha;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  cpu.stop();
  gpu?.stop();
  gpu = null;
  const available = !!(navigator as Navigator & { gpu?: unknown }).gpu;
  if (!usesWebGPU(currentNodes.length, available)) {
    startCpu(expectedToken);
    return;
  }
  try {
    const created = await WebGPULayout.create(
      currentNodes,
      currentEdges,
      currentAlpha,
      (positions) => {
        if (expectedToken === token) publish(positions);
      },
      () => startCpu(expectedToken),
    );
    if (expectedToken !== token) {
      created?.stop();
      return;
    }
    if (!created) {
      startCpu(expectedToken);
      return;
    }
    gpu = created;
    backend("webgpu");
    gpu.start();
  } catch {
    startCpu(expectedToken);
  }
}

function updateNodes(points: LayoutPointLike[]): void {
  for (const point of points) {
    const node = currentById.get(point.id);
    if (node) Object.assign(node, point);
  }
}

type LayoutPointLike = { id: string; x: number; y: number; pinned?: boolean };

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "setData") {
    void setData(message);
  } else if (message.type === "drag") {
    updateNodes(message.points);
    if (gpu) gpu.drag(message.points, message.active);
    else cpu.drag(message.points, message.active);
  } else if (message.type === "pin") {
    updateNodes(message.points);
    if (gpu) gpu.pin(message.points);
    else cpu.pin(message.points);
  } else if (message.type === "reheat") {
    currentAlpha = 1;
    if (gpu) gpu.reheat();
    else cpu.reheat();
  } else {
    token++;
    cpu.stop();
    gpu?.stop();
    gpu = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
};
