import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createControlPlaneClient, type ControlPlaneMetricRecord } from "./control-plane-client.js";
import { createEnterpriseSettingsManager } from "./enterprise-settings.js";

type HeaderInput =
  | Headers
  | Array<[string, string] | string[]>
  | Record<string, string | readonly string[]>
  | undefined;

function getHeader(headers: HeaderInput, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === lower);
    return found?.[1];
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) {
        return value[0];
      }
      return String(value);
    }
  }
  return undefined;
}

describe("control plane client", () => {
  it("returns disabled health state when control plane is off", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-control-plane-client-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();

    const client = createControlPlaneClient(root, manager);
    const result = await client.healthCheck();

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });

  it("blocks metrics ingestion without telemetry consent", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-control-plane-client-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();
    await manager.updateControlPlane({
      mode: "self_hosted",
      baseUrl: "https://control.example.com",
      requireTls: true,
      allowInsecureLocalhost: false
    });

    const client = createControlPlaneClient(root, manager);
    const result = await client.pushMetrics([
      {
        metric_name: "inline_latency_p95",
        ts: new Date().toISOString(),
        value: 220,
        tags: {
          org: "acme",
          repo: "atlas-meridian",
          branch: "main",
          run_id: "run-1"
        }
      }
    ]);

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/consent/i);
  });

  it("pushes signed metric payloads when consent is granted", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-control-plane-client-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();
    await manager.updateTelemetry({ consent: "granted", enabled: true });
    await manager.updateControlPlane({
      mode: "self_hosted",
      baseUrl: "http://localhost:4100",
      requireTls: true,
      allowInsecureLocalhost: true,
      apiToken: "test-token"
    });

    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response("{}", {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    };

    const client = createControlPlaneClient(root, manager, fetchStub);
    const payload: ControlPlaneMetricRecord[] = [
      {
        metric_name: "index_freshness_ms",
        ts: new Date().toISOString(),
        value: 140,
        tags: {
          org: "acme",
          repo: "atlas-meridian",
          branch: "main",
          run_id: "run-2"
        }
      }
    ];

    const result = await client.pushMetrics(payload);
    expect(result.sent).toBe(true);
    expect(result.accepted).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.endsWith("/metrics")).toBe(true);

    const headers = calls[0]?.init?.headers;
    expect(getHeader(headers, "x-atlas-signature")).toBeTruthy();
    expect(getHeader(headers, "x-atlas-payload-sha256")).toBeTruthy();
    expect(getHeader(headers, "authorization")).toBe("Bearer test-token");
  });
});
