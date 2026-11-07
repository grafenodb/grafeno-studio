import { useEffect, useMemo, useRef, useState } from "react";

import { GraphEngine } from "../graph/engine.ts";
import { syntheticGraph, type SyntheticShape } from "../graph/synthetic.ts";
import { enginePalette } from "../graph/theme.ts";

interface Metrics {
  firstFrame: number | null;
  fps: number | null;
  longTasks: number;
  longestTask: number;
}

function integer(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function parameters(): { nodes: number; edges: number; seed: number; shape: SyntheticShape } {
  const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const nodes = integer(query.get("nodes"), 10_000, 200_000);
  const shape = query.get("shape");
  return {
    nodes,
    edges: integer(query.get("edges"), nodes * 3, 600_000),
    seed: integer(query.get("seed"), 1, 0xffffffff),
    shape: shape === "random" || shape === "grid" ? shape : "scale-free",
  };
}

const initialMetrics = (): Metrics => ({ firstFrame: null, fps: null, longTasks: 0, longestTask: 0 });

/** Standalone development page for measuring the graph renderer without a server. */
export function BenchmarkView() {
  const options = useMemo(parameters, []);
  const graph = useMemo(() => syntheticGraph(options.nodes, options.edges, options.shape, options.seed), [options]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<GraphEngine | null>(null);
  const frames = useRef<number[]>([]);
  const started = useRef(0);
  const first = useRef(true);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    setMetrics(initialMetrics());
    first.current = true;
    frames.current = [];
    const observer =
      "PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")
        ? new PerformanceObserver((list) => {
            for (const item of list.getEntries()) {
              setMetrics((value) => ({ ...value, longTasks: value.longTasks + 1, longestTask: Math.max(value.longestTask, item.duration) }));
            }
          })
        : null;
    observer?.observe({ entryTypes: ["longtask"] });
    const created = new GraphEngine(
      canvas.current,
      {
        select: () => undefined,
        open: () => undefined,
        menu: () => undefined,
        connect: () => undefined,
        frame: (at) => {
          frames.current.push(at);
          if (first.current) {
            first.current = false;
            setMetrics((value) => ({ ...value, firstFrame: at - started.current }));
          }
        },
      },
      enginePalette(),
    );
    engine.current = created;
    started.current = performance.now();
    created.setData(graph.nodes, graph.edges);
    return () => {
      observer?.disconnect();
      created.destroy();
      engine.current = null;
    };
  }, [graph]);

  const samplePan = () => {
    if (!engine.current || panning) return;
    setPanning(true);
    frames.current = [];
    const began = performance.now();
    const duration = 3_000;
    const step = (at: number) => {
      const elapsed = at - began;
      engine.current?.panBy(Math.sin(elapsed / 180) * 5, Math.cos(elapsed / 260) * 2);
      if (elapsed < duration) requestAnimationFrame(step);
      else {
        const painted = frames.current.filter((time) => time >= began && time <= at).length;
        setMetrics((value) => ({ ...value, fps: (painted * 1000) / Math.max(1, elapsed) }));
        setPanning(false);
      }
    };
    requestAnimationFrame(step);
  };

  useEffect(() => {
    if (metrics.firstFrame === null) return;
    console.table([
      {
        nodes: options.nodes,
        edges: options.edges,
        shape: options.shape,
        seed: options.seed,
        "first frame (ms)": metrics.firstFrame.toFixed(1),
        "pan fps": metrics.fps?.toFixed(1) ?? "not sampled",
        "long tasks": metrics.longTasks,
        "longest task (ms)": metrics.longestTask.toFixed(1),
      },
    ]);
  }, [metrics, options]);

  return (
    <div className="benchmark-page">
      <canvas ref={canvas} />
      <section className="benchmark-panel">
        <div>
          <span className="eyebrow">Graph benchmark</span>
          <h1>{options.nodes.toLocaleString()} nodes</h1>
          <p className="muted mono">
            {options.edges.toLocaleString()} edges · {options.shape} · seed {options.seed}
          </p>
        </div>
        <dl>
          <div><dt>First frame</dt><dd>{metrics.firstFrame === null ? "Measuring…" : `${metrics.firstFrame.toFixed(1)} ms`}</dd></div>
          <div><dt>Pan rate</dt><dd>{metrics.fps === null ? "Not sampled" : `${metrics.fps.toFixed(1)} fps`}</dd></div>
          <div><dt>Long tasks</dt><dd>{metrics.longTasks}</dd></div>
          <div><dt>Longest</dt><dd>{metrics.longestTask.toFixed(1)} ms</dd></div>
        </dl>
        <button className="primary" disabled={panning || metrics.firstFrame === null} onClick={samplePan}>
          {panning ? "Sampling for 3 seconds…" : "Run pan sample"}
        </button>
        <p className="muted small">Change the URL with nodes, edges, shape and seed. Results are also written with console.table.</p>
      </section>
    </div>
  );
}
