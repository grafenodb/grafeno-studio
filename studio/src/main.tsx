import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";

import { App } from "./App.tsx";
import { BenchmarkView } from "./views/BenchmarkView.tsx";
import "./styles.css";

const benchmark = /^#\/?bench(?:\?|$)/.test(window.location.hash) && (import.meta.env.DEV || "__TAURI_INTERNALS__" in window);

createRoot(document.getElementById("root")!).render(
  benchmark ? (
    <BenchmarkView />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
