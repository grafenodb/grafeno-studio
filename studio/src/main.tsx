import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";

import { App } from "./App.tsx";
import { isBenchmarkRoute } from "./benchmark-route.ts";
import { BenchmarkView } from "./views/BenchmarkView.tsx";
import "./styles.css";

const benchmark = isBenchmarkRoute(window.location.hash);

createRoot(document.getElementById("root")!).render(
  benchmark ? (
    <BenchmarkView />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
