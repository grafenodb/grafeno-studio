import type { LayoutEdgeInput, LayoutNodeInput, LayoutPoint } from "./layout-protocol.ts";

export const WEBGPU_THRESHOLD = 100_000;

export function usesWebGPU(nodeCount: number, available: boolean): boolean {
  return available && nodeCount >= WEBGPU_THRESHOLD;
}

export function buildAdjacency(nodes: Pick<LayoutNodeInput, "id">[], edges: LayoutEdgeInput[]): { indices: Map<string, number>; offsets: Uint32Array; neighbors: Uint32Array } {
  const indices = new Map(nodes.map((node, index) => [node.id, index]));
  const degree = new Uint32Array(nodes.length);
  for (const edge of edges) {
    const from = indices.get(edge.from);
    const to = indices.get(edge.to);
    if (from === undefined || to === undefined) continue;
    degree[from]++;
    if (from !== to) degree[to]++;
  }
  const offsets = new Uint32Array(nodes.length + 1);
  for (let index = 0; index < nodes.length; index++) offsets[index + 1] = offsets[index] + degree[index];
  const neighbors = new Uint32Array(Math.max(1, offsets[nodes.length]));
  const cursor = offsets.slice(0, nodes.length);
  for (const edge of edges) {
    const from = indices.get(edge.from);
    const to = indices.get(edge.to);
    if (from === undefined || to === undefined) continue;
    neighbors[cursor[from]++] = to;
    if (from !== to) neighbors[cursor[to]++] = from;
  }
  return { indices, offsets, neighbors };
}

const BUFFER_USAGE = {
  mapRead: 0x0001,
  copySrc: 0x0004,
  copyDst: 0x0008,
  uniform: 0x0040,
  storage: 0x0080,
};

const SHADER = `
struct Params {
  nodeCount: u32,
  iteration: u32,
  alpha: f32,
  padding: f32,
}
@group(0) @binding(0) var<storage, read> positionsIn: array<vec2f>;
@group(0) @binding(1) var<storage, read> velocitiesIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> positionsOut: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> velocitiesOut: array<vec2f>;
@group(0) @binding(4) var<storage, read> pinned: array<u32>;
@group(0) @binding(5) var<storage, read> offsets: array<u32>;
@group(0) @binding(6) var<storage, read> neighbors: array<u32>;
@group(0) @binding(7) var<uniform> params: Params;

fn hash(value: u32) -> u32 {
  var x = value;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  return (x >> 16u) ^ x;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= params.nodeCount) { return; }
  if (pinned[index] != 0u) {
    positionsOut[index] = positionsIn[index];
    velocitiesOut[index] = vec2f(0.0);
    return;
  }
  let position = positionsIn[index];
  var force = -position * 0.0007;
  let first = offsets[index];
  let last = offsets[index + 1u];
  var cursor = first;
  loop {
    if (cursor >= last) { break; }
    let other = positionsIn[neighbors[cursor]];
    let delta = other - position;
    let distance = max(length(delta), 0.01);
    force += delta / distance * (distance - 55.0) * 0.0022;
    cursor += 1u;
  }
  var sample = 0u;
  loop {
    if (sample >= 8u) { break; }
    let candidate = hash(index * 17u + sample * 7919u + params.iteration * 104729u) % params.nodeCount;
    if (candidate != index) {
      let delta = position - positionsIn[candidate];
      let distance2 = max(dot(delta, delta), 36.0);
      force += delta * (150.0 / (distance2 * sqrt(distance2)));
    }
    sample += 1u;
  }
  var velocity = velocitiesIn[index] * 0.86 + force * params.alpha;
  let speed = length(velocity);
  if (speed > 18.0) { velocity *= 18.0 / speed; }
  velocitiesOut[index] = velocity;
  positionsOut[index] = position + velocity;
}`;

/** Approximate, linear-cost layout for 100k+ nodes. */
export class WebGPULayout {
  private readonly device: GPUDevice;
  private readonly nodeCount: number;
  private readonly positionBytes: number;
  private readonly positions: [GPUBuffer, GPUBuffer];
  private readonly velocities: [GPUBuffer, GPUBuffer];
  private readonly pinned: GPUBuffer;
  private readonly offsets: GPUBuffer;
  private readonly neighbors: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly readback: GPUBuffer;
  private readonly indices: Map<string, number>;
  private readonly pipeline: GPUComputePipeline;
  private readonly groups: [GPUBindGroup, GPUBindGroup];
  private readonly moved: (positions: Float32Array) => void;
  private readonly failed: () => void;
  private parity = 0;
  private iteration = 0;
  private alpha = 1;
  private stopped = false;
  private running = false;

  static async create(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], alpha: number, moved: (positions: Float32Array) => void, failed: () => void): Promise<WebGPULayout | null> {
    const gpu = navigator.gpu;
    if (!usesWebGPU(nodes.length, !!gpu) || !gpu) return null;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    return new WebGPULayout(device, nodes, edges, alpha, moved, failed);
  }

  private constructor(device: GPUDevice, nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], alpha: number, moved: (positions: Float32Array) => void, failed: () => void) {
    this.device = device;
    this.nodeCount = nodes.length;
    this.positionBytes = Math.max(8, nodes.length * 8);
    this.moved = moved;
    this.failed = failed;
    this.alpha = Math.max(0, alpha);
    const storage = BUFFER_USAGE.storage | BUFFER_USAGE.copyDst | BUFFER_USAGE.copySrc;
    this.positions = [device.createBuffer({ size: this.positionBytes, usage: storage }), device.createBuffer({ size: this.positionBytes, usage: storage })];
    this.velocities = [device.createBuffer({ size: this.positionBytes, usage: storage }), device.createBuffer({ size: this.positionBytes, usage: storage })];
    this.pinned = device.createBuffer({ size: Math.max(4, nodes.length * 4), usage: BUFFER_USAGE.storage | BUFFER_USAGE.copyDst });
    const { indices, offsets: offsetData, neighbors: neighborData } = buildAdjacency(nodes, edges);
    this.indices = indices;
    this.offsets = device.createBuffer({ size: offsetData.byteLength, usage: BUFFER_USAGE.storage | BUFFER_USAGE.copyDst });
    this.neighbors = device.createBuffer({ size: neighborData.byteLength, usage: BUFFER_USAGE.storage | BUFFER_USAGE.copyDst });
    this.params = device.createBuffer({ size: 16, usage: BUFFER_USAGE.uniform | BUFFER_USAGE.copyDst });
    this.readback = device.createBuffer({ size: this.positionBytes, usage: BUFFER_USAGE.mapRead | BUFFER_USAGE.copyDst });
    const positionData = new Float32Array(nodes.length * 2);
    const pinData = new Uint32Array(nodes.length);
    nodes.forEach((node, index) => {
      positionData[index * 2] = node.x;
      positionData[index * 2 + 1] = node.y;
      pinData[index] = node.pinned ? 1 : 0;
    });
    for (const buffer of this.positions) device.queue.writeBuffer(buffer, 0, positionData);
    device.queue.writeBuffer(this.pinned, 0, pinData);
    device.queue.writeBuffer(this.offsets, 0, offsetData);
    device.queue.writeBuffer(this.neighbors, 0, neighborData);
    const module = device.createShaderModule({ code: SHADER });
    this.pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const layout = this.pipeline.getBindGroupLayout(0);
    const group = (input: number, output: number) => device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.positions[input] } },
        { binding: 1, resource: { buffer: this.velocities[input] } },
        { binding: 2, resource: { buffer: this.positions[output] } },
        { binding: 3, resource: { buffer: this.velocities[output] } },
        { binding: 4, resource: { buffer: this.pinned } },
        { binding: 5, resource: { buffer: this.offsets } },
        { binding: 6, resource: { buffer: this.neighbors } },
        { binding: 7, resource: { buffer: this.params } },
      ],
    });
    this.groups = [group(0, 1), group(1, 0)];
    device.lost.then(() => {
      if (!this.stopped) this.failed();
    });
  }

  start(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    void this.frame();
  }

  drag(points: LayoutPoint[], active: boolean): void {
    this.writePoints(points, active);
    if (active) this.reheat();
  }

  pin(points: (LayoutPoint & { pinned: boolean })[]): void {
    for (const point of points) this.writePoint(point, point.pinned);
    if (points.some((point) => !point.pinned)) this.reheat();
  }

  reheat(): void {
    this.alpha = 1;
    this.start();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const buffer of [...this.positions, ...this.velocities, this.pinned, this.offsets, this.neighbors, this.params, this.readback]) buffer.destroy();
    this.device.destroy();
  }

  private async frame(): Promise<void> {
    if (this.stopped) return;
    try {
      const params = new ArrayBuffer(16);
      const params32 = new Uint32Array(params);
      params32[0] = this.nodeCount;
      params32[1] = this.iteration;
      new Float32Array(params)[2] = this.alpha;
      this.device.queue.writeBuffer(this.params, 0, new Uint8Array(params));
      const encoder = this.device.createCommandEncoder();
      const steps = this.alpha > 0.08 ? 4 : 1;
      for (let step = 0; step < steps; step++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.groups[this.parity]);
        pass.dispatchWorkgroups(Math.ceil(this.nodeCount / 256));
        pass.end();
        this.parity = 1 - this.parity;
      }
      const current = this.positions[this.parity];
      encoder.copyBufferToBuffer(current, 0, this.readback, 0, this.positionBytes);
      this.device.queue.submit([encoder.finish()]);
      await this.readback.mapAsync(1);
      const copy = new Float32Array(this.readback.getMappedRange().slice(0));
      this.readback.unmap();
      this.moved(copy);
      this.iteration += steps;
      this.alpha *= 0.975;
      if (this.alpha < 0.008) {
        this.running = false;
        return;
      }
      setTimeout(() => void this.frame(), 16);
    } catch {
      if (!this.stopped) this.failed();
    }
  }

  private writePoints(points: LayoutPoint[], pinned: boolean): void {
    for (const point of points) this.writePoint(point, pinned);
  }

  private writePoint(point: LayoutPoint, pinned: boolean): void {
    const index = this.indices.get(point.id);
    if (index === undefined) return;
    const position = new Float32Array([point.x, point.y]);
    const velocity = new Float32Array([0, 0]);
    const flag = new Uint32Array([pinned ? 1 : 0]);
    for (const buffer of this.positions) this.device.queue.writeBuffer(buffer, index * 8, position);
    for (const buffer of this.velocities) this.device.queue.writeBuffer(buffer, index * 8, velocity);
    this.device.queue.writeBuffer(this.pinned, index * 4, flag);
  }
}
