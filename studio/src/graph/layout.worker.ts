import type { LayoutRequest, LayoutResponse } from "./layout-protocol.ts";
import { LayoutSimulation } from "./layout-simulation.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const simulation = new LayoutSimulation(schedulePositions);

function schedulePositions(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    const positions = simulation.positions();
    scope.postMessage({ type: "positions", generation, positions }, [positions.buffer]);
  }, 16);
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "setData") {
    generation = message.generation;
    simulation.setData(message.nodes, message.edges, message.alpha);
    if (message.alpha <= 0) schedulePositions();
  } else if (message.type === "drag") {
    simulation.drag(message.points, message.active);
  } else if (message.type === "pin") {
    simulation.pin(message.points);
  } else if (message.type === "reheat") {
    simulation.reheat();
  } else {
    simulation.stop();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
};
