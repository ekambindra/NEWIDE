import { fileURLToPath } from "node:url";

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);

export function buildTickPayload(ts: string, databaseUrlSet: boolean): { service: string; ts: string; database_url_set: boolean } {
  return {
    service: "worker-service",
    ts,
    database_url_set: databaseUrlSet
  };
}

function tick(): void {
  const payload = buildTickPayload(new Date().toISOString(), Boolean(process.env.DATABASE_URL));
  console.log(JSON.stringify(payload));
}

export function startWorker(currentIntervalMs = intervalMs): void {
  tick();
  setInterval(tick, currentIntervalMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startWorker();
}
