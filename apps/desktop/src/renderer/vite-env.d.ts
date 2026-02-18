/// <reference types="vite/client" />

declare global {
  interface Window {
    ide: import("../main/preload.cts").PreloadApi;
  }
}

export {};
