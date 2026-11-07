import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";

import { App } from "./App.tsx";
import { BenchmarkView } from "./views/BenchmarkView.tsx";
import "./styles.css";

const benchmark = import.meta.env.DEV && /^#\/?bench(?:\?|$)/.test(window.location.hash);

createRoot(document.getElementById("root")!).render(
  benchmark ? (
    <BenchmarkView />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
