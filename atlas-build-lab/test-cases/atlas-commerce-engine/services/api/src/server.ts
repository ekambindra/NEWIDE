import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const port = Number(process.env.API_PORT ?? 4000);
const service = "api-service";

export function buildHealthPayload(databaseUrlSet: boolean): { status: string; service: string; database_url_set: boolean } {
  return {
    status: "ok",
    service,
    database_url_set: databaseUrlSet
  };
}

export function buildRoutePayload(route: string): { service: string; route: string } {
  return {
    service,
    route
  };
}

export function startServer(currentPort = port): void {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      const payload = buildHealthPayload(Boolean(process.env.DATABASE_URL));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(buildRoutePayload(req.url ?? "/")));
  });

  server.listen(currentPort, () => {
    console.log(`[api-service] listening on ${currentPort}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
