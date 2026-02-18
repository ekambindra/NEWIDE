import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ControlPlaneMode,
  EnterpriseSettings,
  EnterpriseSettingsManager
} from "./enterprise-settings.js";

export type ControlPlaneHealthResult = {
  ok: boolean;
  mode: ControlPlaneMode;
  url: string | null;
  statusCode: number | null;
  reason: string | null;
};

export type ControlPlanePushResult = {
  sent: boolean;
  accepted: number;
  url: string | null;
  statusCode: number | null;
  reason: string | null;
};

export type ControlPlaneMetricRecord = {
  metric_name: string;
  ts: string;
  value: number;
  tags: {
    org: string;
    repo: string;
    branch: string;
    run_id: string;
  };
};

type FetchImpl = typeof fetch;

type ControlPlaneClient = {
  healthCheck: () => Promise<ControlPlaneHealthResult>;
  pushMetrics: (records: ControlPlaneMetricRecord[]) => Promise<ControlPlanePushResult>;
  pushAuditEvents: (records: Array<Record<string, unknown>>) => Promise<ControlPlanePushResult>;
};

type PreparedRequest = {
  url: string;
  settings: EnterpriseSettings;
};

function sanitizeBaseUrl(base: string): string {
  return base.replace(/\/+$/, "");
}

function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

async function readOrSeedSecret(path: string): Promise<string> {
  await fs.mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const existing = (await fs.readFile(path, "utf8")).trim();
    if (existing) {
      return existing;
    }
  }
  const seeded = randomBytes(32).toString("hex");
  await fs.writeFile(path, `${seeded}\n`, "utf8");
  return seeded;
}

export function createControlPlaneClient(
  root: string,
  settingsManager: EnterpriseSettingsManager,
  fetchImpl: FetchImpl = fetch
): ControlPlaneClient {
  const signingKeyPath = join(root, "security", "control-plane-signing.key");
  let signingSecret: string | null = null;

  async function getSigningSecret(): Promise<string> {
    if (signingSecret) {
      return signingSecret;
    }
    signingSecret = await readOrSeedSecret(signingKeyPath);
    return signingSecret;
  }

  async function buildSignedHeaders(
    payload: string,
    settings: EnterpriseSettings
  ): Promise<Record<string, string>> {
    const timestamp = new Date().toISOString();
    const secret = await getSigningSecret();
    const digest = hashPayload(payload);
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${digest}`)
      .digest("hex");

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-atlas-timestamp": timestamp,
      "x-atlas-payload-sha256": digest,
      "x-atlas-signature": signature,
      "x-atlas-signature-key": "local-v1"
    };
    if (settings.controlPlane.apiToken) {
      headers.authorization = `Bearer ${settings.controlPlane.apiToken}`;
    }
    if (settings.controlPlane.orgId) {
      headers["x-atlas-org-id"] = settings.controlPlane.orgId;
    }
    if (settings.controlPlane.workspaceId) {
      headers["x-atlas-workspace-id"] = settings.controlPlane.workspaceId;
    }
    return headers;
  }

  async function prepare(pathname: string): Promise<PreparedRequest | { error: string; mode: ControlPlaneMode }> {
    const settings = await settingsManager.getSettings();
    if (settings.controlPlane.mode === "disabled") {
      return {
        error: "control plane disabled",
        mode: settings.controlPlane.mode
      };
    }

    let baseUrl: string | null;
    try {
      baseUrl = await settingsManager.resolveControlPlaneBaseUrl();
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "control plane url is invalid",
        mode: settings.controlPlane.mode
      };
    }

    if (!baseUrl) {
      return {
        error: "control plane disabled",
        mode: settings.controlPlane.mode
      };
    }

    const normalized = sanitizeBaseUrl(baseUrl);
    const url = new URL(pathname.replace(/^\/+/, ""), `${normalized}/`).toString();
    return { url, settings };
  }

  return {
    async healthCheck(): Promise<ControlPlaneHealthResult> {
      const prepared = await prepare("/health");
      if ("error" in prepared) {
        return {
          ok: false,
          mode: prepared.mode,
          url: null,
          statusCode: null,
          reason: prepared.error
        };
      }

      try {
        const headers = await buildSignedHeaders("", prepared.settings);
        const response = await fetchImpl(prepared.url, {
          method: "GET",
          headers
        });

        return {
          ok: response.ok,
          mode: prepared.settings.controlPlane.mode,
          url: prepared.url,
          statusCode: response.status,
          reason: response.ok ? null : `health check failed (${response.status})`
        };
      } catch (error) {
        return {
          ok: false,
          mode: prepared.settings.controlPlane.mode,
          url: prepared.url,
          statusCode: null,
          reason: error instanceof Error ? error.message : "health check failed"
        };
      }
    },

    async pushMetrics(records: ControlPlaneMetricRecord[]): Promise<ControlPlanePushResult> {
      if (records.length === 0) {
        return {
          sent: true,
          accepted: 0,
          url: null,
          statusCode: null,
          reason: null
        };
      }

      const decision = await settingsManager.canSendTelemetry();
      if (!decision.allowed) {
        return {
          sent: false,
          accepted: 0,
          url: null,
          statusCode: null,
          reason: decision.reason
        };
      }

      const prepared = await prepare("/metrics");
      if ("error" in prepared) {
        return {
          sent: false,
          accepted: 0,
          url: null,
          statusCode: null,
          reason: prepared.error
        };
      }

      const payload = JSON.stringify(records);
      try {
        const headers = await buildSignedHeaders(payload, prepared.settings);
        const response = await fetchImpl(prepared.url, {
          method: "POST",
          headers,
          body: payload
        });

        if (!response.ok) {
          return {
            sent: false,
            accepted: 0,
            url: prepared.url,
            statusCode: response.status,
            reason: `metrics ingestion failed (${response.status})`
          };
        }

        return {
          sent: true,
          accepted: records.length,
          url: prepared.url,
          statusCode: response.status,
          reason: null
        };
      } catch (error) {
        return {
          sent: false,
          accepted: 0,
          url: prepared.url,
          statusCode: null,
          reason: error instanceof Error ? error.message : "metrics ingestion failed"
        };
      }
    },

    async pushAuditEvents(records: Array<Record<string, unknown>>): Promise<ControlPlanePushResult> {
      if (records.length === 0) {
        return {
          sent: true,
          accepted: 0,
          url: null,
          statusCode: null,
          reason: null
        };
      }

      const prepared = await prepare("/audit/events");
      if ("error" in prepared) {
        return {
          sent: false,
          accepted: 0,
          url: null,
          statusCode: null,
          reason: prepared.error
        };
      }

      let accepted = 0;
      let lastStatusCode: number | null = null;

      for (const record of records) {
        const payload = JSON.stringify(record);
        const headers = await buildSignedHeaders(payload, prepared.settings);
        try {
          const response = await fetchImpl(prepared.url, {
            method: "POST",
            headers,
            body: payload
          });
          lastStatusCode = response.status;
          if (!response.ok) {
            return {
              sent: false,
              accepted,
              url: prepared.url,
              statusCode: response.status,
              reason: `audit ingestion failed (${response.status})`
            };
          }
          accepted += 1;
        } catch (error) {
          return {
            sent: false,
            accepted,
            url: prepared.url,
            statusCode: lastStatusCode,
            reason: error instanceof Error ? error.message : "audit ingestion failed"
          };
        }
      }

      return {
        sent: true,
        accepted,
        url: prepared.url,
        statusCode: lastStatusCode,
        reason: null
      };
    }
  };
}
