export const WEBGL_THRESHOLD = 3_000;

export function usesWebGL(nodeCount: number, available = true): boolean {
  return available && nodeCount > WEBGL_THRESHOLD;
}

export interface RenderNode {
  id: string;
  color: string;
  size: number;
  x?: number;
  y?: number;
}

export interface RenderEdge {
  source: RenderNode;
  target: RenderNode;
}

export interface RenderPalette {
  muted: string;
  panel: string;
}

export type PickedGraphItem = { kind: "node"; index: number } | { kind: "edge"; index: number } | null;

export function decodePickId(id: number, edgeCount: number, nodeCount: number): PickedGraphItem {
  if (id <= 0) return null;
  if (id <= edgeCount) return { kind: "edge", index: id - 1 };
  const index = id - edgeCount - 1;
  return index < nodeCount ? { kind: "node", index } : null;
}

const NODE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in float aSize;
layout(location=1) in vec4 aColor;
layout(location=2) in float aPick;
uniform sampler2D uPositions;
uniform int uTextureWidth;
uniform vec3 uView;
uniform vec2 uViewport;
out vec2 vLocal;
out vec4 vColor;
flat out uint vPick;
vec2 positionAt(int index) {
  return texelFetch(uPositions, ivec2(index % uTextureWidth, index / uTextureWidth), 0).rg;
}
void main() {
  int vertex = gl_VertexID;
  vec2 local = vec2((vertex == 1 || vertex == 3) ? 1.0 : -1.0, vertex >= 2 ? 1.0 : -1.0);
  vec2 screen = positionAt(gl_InstanceID) * uView.z + uView.xy + local * aSize * uView.z;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  vLocal = local;
  vColor = aColor;
  vPick = uint(aPick);
}`;

const NODE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
uniform vec4 uPanel;
out vec4 outColor;
void main() {
  vec2 p = abs(vLocal);
  float side = 1.0 - p.x * 0.57735027;
  if (p.x > 0.87 || p.y > side) discard;
  float border = min(0.87 - p.x, side - p.y);
  outColor = border < 0.08 ? mix(vColor, uPanel, 0.72) : vColor;
}`;

const EDGE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in float aSource;
layout(location=1) in float aTarget;
layout(location=2) in float aPick;
uniform sampler2D uPositions;
uniform int uTextureWidth;
uniform vec3 uView;
uniform vec2 uViewport;
uniform float uWidth;
flat out uint vPick;
vec2 positionAt(int index) {
  return texelFetch(uPositions, ivec2(index % uTextureWidth, index / uTextureWidth), 0).rg;
}
void main() {
  int vertex = gl_VertexID;
  vec2 a = positionAt(int(aSource)) * uView.z + uView.xy;
  vec2 b = positionAt(int(aTarget)) * uView.z + uView.xy;
  vec2 direction = b - a;
  float distance = max(length(direction), 0.001);
  vec2 normal = vec2(-direction.y, direction.x) / distance;
  bool atEnd = vertex == 1 || vertex == 3;
  float side = vertex >= 2 ? 1.0 : -1.0;
  vec2 screen = (atEnd ? b : a) + normal * uWidth * 0.5 * side;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  vPick = uint(aPick);
}`;

const EDGE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const PICK_FRAGMENT = `#version 300 es
precision highp float;
flat in uint vPick;
out vec4 outColor;
void main() {
  outColor = vec4(float(vPick & 255u), float((vPick >> 8u) & 255u), float((vPick >> 16u) & 255u), 255.0) / 255.0;
}`;

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type);
  if (!result) throw new Error("WebGL shader allocation failed");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? "WebGL shader compilation failed");
  return result;
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const result = gl.createProgram();
  if (!result) throw new Error("WebGL program allocation failed");
  const vertexShader = shader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = shader(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(result, vertexShader);
  gl.attachShader(result, fragmentShader);
  gl.linkProgram(result);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? "WebGL program link failed");
  return result;
}

function color(value: string, alpha = 1): [number, number, number, number] {
  const hex = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255, alpha];
  if (/^#[0-9a-f]{3}$/i.test(hex)) return [Number.parseInt(hex[1] + hex[1], 16) / 255, Number.parseInt(hex[2] + hex[2], 16) / 255, Number.parseInt(hex[3] + hex[3], 16) / 255, alpha];
  const rgb = hex.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i);
  return rgb ? [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, alpha] : [0.5, 0.55, 0.6, alpha];
}

/** A compact WebGL2 renderer used only above the Canvas 2D threshold. */
export class WebGLGraphRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly nodeProgram: WebGLProgram;
  private readonly edgeProgram: WebGLProgram;
  private readonly nodePickProgram: WebGLProgram;
  private readonly edgePickProgram: WebGLProgram;
  private readonly nodeBuffer!: WebGLBuffer;
  private readonly edgeBuffer!: WebGLBuffer;
  private readonly nodeVao!: WebGLVertexArrayObject;
  private readonly edgeVao!: WebGLVertexArrayObject;
  private readonly positionTexture!: WebGLTexture;
  private readonly pickTexture!: WebGLTexture;
  private readonly pickFramebuffer!: WebGLFramebuffer;
  private nodeCount = 0;
  private edgeCount = 0;
  private textureWidth = 1;
  private textureHeight = 1;
  private positions = new Float32Array(2);
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lost = false;
  private renderVersion = 0;
  private cachedPick: { version: number; x: number; y: number; value: PickedGraphItem } | null = null;

  static create(overlay: HTMLCanvasElement): WebGLGraphRenderer | null {
    const canvas = document.createElement("canvas");
    canvas.className = "graph-webgl";
    canvas.setAttribute("aria-hidden", "true");
    overlay.parentElement?.insertBefore(canvas, overlay);
    try {
      const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false });
      if (!gl) throw new Error("WebGL2 is unavailable");
      return new WebGLGraphRenderer(canvas, gl);
    } catch {
      canvas.remove();
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.nodeProgram = program(gl, NODE_VERTEX, NODE_FRAGMENT);
    this.edgeProgram = program(gl, EDGE_VERTEX, EDGE_FRAGMENT);
    this.nodePickProgram = program(gl, NODE_VERTEX, PICK_FRAGMENT);
    this.edgePickProgram = program(gl, EDGE_VERTEX, PICK_FRAGMENT);
    const nodeBuffer = gl.createBuffer();
    const edgeBuffer = gl.createBuffer();
    const nodeVao = gl.createVertexArray();
    const edgeVao = gl.createVertexArray();
    const positionTexture = gl.createTexture();
    const pickTexture = gl.createTexture();
    const pickFramebuffer = gl.createFramebuffer();
    if (!nodeBuffer || !edgeBuffer || !nodeVao || !edgeVao || !positionTexture || !pickTexture || !pickFramebuffer) throw new Error("WebGL resource allocation failed");
    Object.assign(this, { nodeBuffer, edgeBuffer, nodeVao, edgeVao, positionTexture, pickTexture, pickFramebuffer });

    gl.bindVertexArray(nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 4);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
    for (let location = 0; location < 3; location++) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 12, location * 4);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
  }

  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible;
    this.canvas.style.display = visible ? "block" : "none";
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width === pixelWidth && this.canvas.height === pixelHeight) return;
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) this.lost = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cachedPick = null;
  }

  setData(nodes: RenderNode[], edges: RenderEdge[]): void {
    const { gl } = this;
    this.nodeCount = nodes.length;
    const indices = new Map(nodes.map((node, index) => [node.id, index]));
    const nodeData = new Float32Array(nodes.length * 6);
    for (let index = 0; index < nodes.length; index++) {
      const rgba = color(nodes[index].color);
      nodeData.set([nodes[index].size, ...rgba, edges.length + index + 1], index * 6);
    }
    const keptEdges = edges.filter((edge) => indices.has(edge.source.id) && indices.has(edge.target.id));
    this.edgeCount = keptEdges.length;
    const edgeData = new Float32Array(keptEdges.length * 3);
    for (let index = 0; index < keptEdges.length; index++) {
      edgeData.set([indices.get(keptEdges[index].source.id)!, indices.get(keptEdges[index].target.id)!, index + 1], index * 3);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, nodeData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edgeData, gl.STATIC_DRAW);

    const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.textureWidth = Math.max(1, Math.min(maximum, nodes.length));
    this.textureHeight = Math.max(1, Math.ceil(nodes.length / this.textureWidth));
    this.positions = new Float32Array(this.textureWidth * this.textureHeight * 2);
    gl.bindTexture(gl.TEXTURE_2D, this.positionTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, this.textureWidth, this.textureHeight, 0, gl.RG, gl.FLOAT, this.positions);
    this.cachedPick = null;
  }

  render(nodes: RenderNode[], view: { x: number; y: number; k: number }, palette: RenderPalette): boolean {
    if (this.lost || nodes.length !== this.nodeCount) return false;
    const { gl } = this;
    for (let index = 0; index < nodes.length; index++) {
      this.positions[index * 2] = nodes[index].x ?? 0;
      this.positions[index * 2 + 1] = nodes[index].y ?? 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.positionTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.textureWidth, this.textureHeight, gl.RG, gl.FLOAT, this.positions);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.drawEdges(this.edgeProgram, view, 1.1, color(palette.muted, 0.48));
    this.drawNodes(this.nodeProgram, view, color(palette.panel));

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawEdges(this.edgePickProgram, view, 7, null);
    this.drawNodes(this.nodePickProgram, view, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderVersion++;
    this.cachedPick = null;
    return true;
  }

  pick(x: number, y: number): PickedGraphItem {
    if (this.lost || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    if (this.cachedPick?.version === this.renderVersion && this.cachedPick.x === x && this.cachedPick.y === y) return this.cachedPick.value;
    const pixel = new Uint8Array(4);
    const px = Math.min(this.canvas.width - 1, Math.max(0, Math.floor(x * this.dpr)));
    const py = Math.min(this.canvas.height - 1, Math.max(0, Math.floor((this.height - y) * this.dpr)));
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.pickFramebuffer);
    this.gl.readPixels(px, py, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    const id = pixel[0] | (pixel[1] << 8) | (pixel[2] << 16);
    const value = decodePickId(id, this.edgeCount, this.nodeCount);
    this.cachedPick = { version: this.renderVersion, x, y, value };
    return value;
  }

  destroy(): void {
    const { gl } = this;
    gl.deleteBuffer(this.nodeBuffer);
    gl.deleteBuffer(this.edgeBuffer);
    gl.deleteVertexArray(this.nodeVao);
    gl.deleteVertexArray(this.edgeVao);
    gl.deleteTexture(this.positionTexture);
    gl.deleteTexture(this.pickTexture);
    gl.deleteFramebuffer(this.pickFramebuffer);
    for (const item of [this.nodeProgram, this.edgeProgram, this.nodePickProgram, this.edgePickProgram]) gl.deleteProgram(item);
    this.canvas.remove();
  }

  private uniforms(program: WebGLProgram, view: { x: number; y: number; k: number }): void {
    const { gl } = this;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.positionTexture);
    gl.uniform1i(gl.getUniformLocation(program, "uPositions"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "uTextureWidth"), this.textureWidth);
    gl.uniform3f(gl.getUniformLocation(program, "uView"), view.x, view.y, view.k);
    gl.uniform2f(gl.getUniformLocation(program, "uViewport"), this.width, this.height);
  }

  private drawNodes(program: WebGLProgram, view: { x: number; y: number; k: number }, panel: [number, number, number, number] | null): void {
    const { gl } = this;
    this.uniforms(program, view);
    if (panel) gl.uniform4fv(gl.getUniformLocation(program, "uPanel"), panel);
    gl.bindVertexArray(this.nodeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nodeCount);
  }

  private drawEdges(program: WebGLProgram, view: { x: number; y: number; k: number }, width: number, edgeColor: [number, number, number, number] | null): void {
    const { gl } = this;
    this.uniforms(program, view);
    gl.uniform1f(gl.getUniformLocation(program, "uWidth"), width);
    if (edgeColor) gl.uniform4fv(gl.getUniformLocation(program, "uColor"), edgeColor);
    gl.bindVertexArray(this.edgeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.edgeCount);
  }
}
