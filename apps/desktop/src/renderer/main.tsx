import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppBoundary } from "./AppBoundary";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </React.StrictMode>
);
