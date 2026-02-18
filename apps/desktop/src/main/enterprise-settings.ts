import { existsSync, promises as fs } from "node:fs";
import { dirname, join } from "node:path";

export type TelemetryConsent = "unknown" | "granted" | "denied";
export type ControlPlaneMode = "disabled" | "managed" | "self_hosted";

export type TelemetrySettings = {
  consent: TelemetryConsent;
  enabled: boolean;
  privacyMode: boolean;
  consentedAt: string | null;
  lastUpdated: string;
};

export type ControlPlaneSettings = {
  mode: ControlPlaneMode;
  baseUrl: string;
  requireTls: boolean;
  allowInsecureLocalhost: boolean;
  apiToken: string | null;
  orgId: string | null;
  workspaceId: string | null;
  lastUpdated: string;
};

export type EnterpriseSettings = {
  version: 1;
  updatedAt: string;
  telemetry: TelemetrySettings;
  controlPlane: ControlPlaneSettings;
};

export type TelemetryDecision = {
  allowed: boolean;
  reason: string;
};

export type UpdateTelemetryInput = {
  consent?: TelemetryConsent;
  enabled?: boolean;
};

export type UpdateControlPlaneInput = Partial<
  Omit<ControlPlaneSettings, "lastUpdated">
>;

export type EnterpriseSettingsManager = {
  initialize: () => Promise<void>;
  getSettings: () => Promise<EnterpriseSettings>;
  updateTelemetry: (input: UpdateTelemetryInput) => Promise<EnterpriseSettings>;
  setPrivacyMode: (enabled: boolean) => Promise<EnterpriseSettings>;
  updateControlPlane: (input: UpdateControlPlaneInput) => Promise<EnterpriseSettings>;
  canSendTelemetry: () => Promise<TelemetryDecision>;
  resolveControlPlaneBaseUrl: () => Promise<string | null>;
};

const DEFAULT_MANAGED_URL = "https://control.atlasmeridian.dev";

function nowIso(): string {
  return new Date().toISOString();
}

function cloneSettings(settings: EnterpriseSettings): EnterpriseSettings {
  return JSON.parse(JSON.stringify(settings)) as EnterpriseSettings;
}

function defaultSettings(): EnterpriseSettings {
  const now = nowIso();
  return {
    version: 1,
    updatedAt: now,
    telemetry: {
      consent: "unknown",
      enabled: false,
      privacyMode: false,
      consentedAt: null,
      lastUpdated: now
    },
    controlPlane: {
      mode: "disabled",
      baseUrl: DEFAULT_MANAGED_URL,
      requireTls: true,
      allowInsecureLocalhost: false,
      apiToken: null,
      orgId: null,
      workspaceId: null,
      lastUpdated: now
    }
  };
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1";
}

function ensureTlsPolicy(input: {
  baseUrl: string;
  requireTls: boolean;
  allowInsecureLocalhost: boolean;
}): string {
  const normalized = normalizeBaseUrl(input.baseUrl);
  if (!normalized) {
    throw new Error("control plane base URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("control plane base URL must be a valid absolute URL");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("control plane URL must use http or https");
  }

  if (input.requireTls && protocol !== "https:") {
    if (!(input.allowInsecureLocalhost && isLoopbackHost(parsed.hostname))) {
      throw new Error("TLS is required for control plane connections");
    }
  }

  return parsed.toString().replace(/\/+$/, "");
}

async function readJson(path: string): Promise<EnterpriseSettings | null> {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as EnterpriseSettings;
  } catch {
    return null;
  }
}

export function createEnterpriseSettingsManager(root: string): EnterpriseSettingsManager {
  const settingsPath = join(root, "enterprise", "settings.json");
  let cached: EnterpriseSettings | null = null;

  async function persist(next: EnterpriseSettings): Promise<EnterpriseSettings> {
    next.updatedAt = nowIso();
    await fs.mkdir(dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    cached = cloneSettings(next);
    return cloneSettings(next);
  }

  async function load(): Promise<EnterpriseSettings> {
    if (cached) {
      return cloneSettings(cached);
    }

    const fromDisk = await readJson(settingsPath);
    if (!fromDisk) {
      const seeded = defaultSettings();
      return persist(seeded);
    }

    const seeded = defaultSettings();
    const merged: EnterpriseSettings = {
      version: 1,
      updatedAt: fromDisk.updatedAt ?? seeded.updatedAt,
      telemetry: {
        ...seeded.telemetry,
        ...(fromDisk.telemetry ?? {})
      },
      controlPlane: {
        ...seeded.controlPlane,
        ...(fromDisk.controlPlane ?? {})
      }
    };

    merged.controlPlane.baseUrl = normalizeBaseUrl(merged.controlPlane.baseUrl) || DEFAULT_MANAGED_URL;
    merged.telemetry.enabled =
      merged.telemetry.enabled &&
      merged.telemetry.consent === "granted" &&
      !merged.telemetry.privacyMode;

    cached = cloneSettings(merged);
    return cloneSettings(merged);
  }

  return {
    async initialize(): Promise<void> {
      await load();
    },

    async getSettings(): Promise<EnterpriseSettings> {
      return load();
    },

    async updateTelemetry(input: UpdateTelemetryInput): Promise<EnterpriseSettings> {
      const current = await load();
      const now = nowIso();

      const consent = input.consent ?? current.telemetry.consent;
      let enabled = input.enabled ?? current.telemetry.enabled;
      const consentedAt =
        input.consent === undefined
          ? current.telemetry.consentedAt
          : consent === "granted"
            ? now
            : null;

      if (consent !== "granted" || current.telemetry.privacyMode) {
        enabled = false;
      }

      const next: EnterpriseSettings = {
        ...current,
        telemetry: {
          ...current.telemetry,
          consent,
          enabled,
          consentedAt,
          lastUpdated: now
        }
      };
      return persist(next);
    },

    async setPrivacyMode(enabled: boolean): Promise<EnterpriseSettings> {
      const current = await load();
      const now = nowIso();
      const next: EnterpriseSettings = {
        ...current,
        telemetry: {
          ...current.telemetry,
          privacyMode: enabled,
          enabled: enabled ? false : current.telemetry.enabled,
          lastUpdated: now
        }
      };
      return persist(next);
    },

    async updateControlPlane(input: UpdateControlPlaneInput): Promise<EnterpriseSettings> {
      const current = await load();
      const now = nowIso();

      const mode = input.mode ?? current.controlPlane.mode;
      const requireTls = input.requireTls ?? current.controlPlane.requireTls;
      const allowInsecureLocalhost =
        input.allowInsecureLocalhost ?? current.controlPlane.allowInsecureLocalhost;

      const baseUrlRaw =
        normalizeBaseUrl(input.baseUrl ?? current.controlPlane.baseUrl) || DEFAULT_MANAGED_URL;
      const validatedBaseUrl =
        mode === "disabled"
          ? baseUrlRaw
          : ensureTlsPolicy({
              baseUrl: baseUrlRaw,
              requireTls,
              allowInsecureLocalhost
            });

      const next: EnterpriseSettings = {
        ...current,
        controlPlane: {
          ...current.controlPlane,
          ...input,
          mode,
          requireTls,
          allowInsecureLocalhost,
          baseUrl: validatedBaseUrl,
          apiToken: input.apiToken === undefined ? current.controlPlane.apiToken : input.apiToken,
          orgId: input.orgId === undefined ? current.controlPlane.orgId : input.orgId,
          workspaceId:
            input.workspaceId === undefined ? current.controlPlane.workspaceId : input.workspaceId,
          lastUpdated: now
        }
      };

      return persist(next);
    },

    async canSendTelemetry(): Promise<TelemetryDecision> {
      const settings = await load();
      if (settings.telemetry.privacyMode) {
        return { allowed: false, reason: "privacy mode enabled" };
      }
      if (settings.telemetry.consent !== "granted") {
        return { allowed: false, reason: "telemetry consent not granted" };
      }
      if (!settings.telemetry.enabled) {
        return { allowed: false, reason: "telemetry disabled" };
      }
      return { allowed: true, reason: "allowed" };
    },

    async resolveControlPlaneBaseUrl(): Promise<string | null> {
      const settings = await load();
      if (settings.controlPlane.mode === "disabled") {
        return null;
      }
      return ensureTlsPolicy({
        baseUrl: settings.controlPlane.baseUrl,
        requireTls: settings.controlPlane.requireTls,
        allowInsecureLocalhost: settings.controlPlane.allowInsecureLocalhost
      });
    }
  };
}
