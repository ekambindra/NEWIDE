import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEncryptedMetadataStore } from "./encrypted-store.js";

describe("encrypted metadata store", () => {
  it("persists control-plane metadata encrypted at rest", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-control-plane-store-"));
    const store = createEncryptedMetadataStore({ dataDir: root, encryptionKey: "unit-test-key" });

    store.save({
      orgs: [{ id: "org-1", name: "Acme Corp" }],
      workspaces: [{ id: "ws-1", orgId: "org-1", name: "Prod" }],
      policies: [{ id: "policy-1", orgId: "org-1", payload: { mode: "balanced" } }],
      auditEvents: [{ action: "org.create" }],
      metrics: [{ metric_name: "green_pipeline_rate", value: 95 }]
    });

    const encryptedRaw = await readFile(store.getDataPath(), "utf8");
    expect(encryptedRaw.includes("Acme Corp")).toBe(false);
    expect(encryptedRaw.includes("green_pipeline_rate")).toBe(false);

    const loaded = store.load();
    expect(loaded.orgs[0]?.name).toBe("Acme Corp");
    expect(loaded.metrics[0]?.metric_name).toBe("green_pipeline_rate");
  });

  it("supports backup and restore flows", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-control-plane-store-"));
    const store = createEncryptedMetadataStore({ dataDir: root, encryptionKey: "backup-key" });

    store.save({
      orgs: [{ id: "org-2", name: "Original" }],
      workspaces: [],
      policies: [],
      auditEvents: [],
      metrics: []
    });
    const backupPath = store.exportBackup();

    store.save({
      orgs: [{ id: "org-2", name: "Mutated" }],
      workspaces: [],
      policies: [],
      auditEvents: [],
      metrics: []
    });

    const restored = store.importBackup(backupPath);
    expect(restored.orgs[0]?.name).toBe("Original");
  });
});
