import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEnterpriseSettingsManager } from "./enterprise-settings.js";

describe("enterprise settings manager", () => {
  it("seeds telemetry opt-in defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-enterprise-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();

    const settings = await manager.getSettings();
    expect(settings.telemetry.consent).toBe("unknown");
    expect(settings.telemetry.enabled).toBe(false);
    expect(settings.telemetry.privacyMode).toBe(false);
    expect(settings.controlPlane.mode).toBe("disabled");
    expect(settings.security.mode).toBe("balanced");
  });

  it("enforces consent and privacy mode for telemetry", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-enterprise-telemetry-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();

    await manager.updateTelemetry({ consent: "granted", enabled: true });
    let decision = await manager.canSendTelemetry();
    expect(decision.allowed).toBe(true);

    await manager.setPrivacyMode(true);
    decision = await manager.canSendTelemetry();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/privacy mode/i);

    const settings = await manager.getSettings();
    expect(settings.telemetry.enabled).toBe(false);
  });

  it("enforces tls for control-plane urls unless localhost override is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-enterprise-tls-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();

    await expect(
      manager.updateControlPlane({
        mode: "self_hosted",
        baseUrl: "http://gateway.example.com",
        requireTls: true,
        allowInsecureLocalhost: false
      })
    ).rejects.toThrow(/TLS is required/i);

    const updated = await manager.updateControlPlane({
      mode: "self_hosted",
      baseUrl: "http://localhost:4100",
      requireTls: true,
      allowInsecureLocalhost: true
    });

    expect(updated.controlPlane.mode).toBe("self_hosted");
    expect(updated.controlPlane.baseUrl).toBe("http://localhost:4100");

    const resolved = await manager.resolveControlPlaneBaseUrl();
    expect(resolved).toBe("http://localhost:4100");
  });

  it("persists strict security mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-enterprise-security-mode-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();

    const updated = await manager.updateSecurityMode("strict");
    expect(updated.security.mode).toBe("strict");

    const loaded = await manager.getSettings();
    expect(loaded.security.mode).toBe("strict");
  });
});
