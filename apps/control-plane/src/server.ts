import express from "express";
import helmet from "helmet";
import { join } from "node:path";
import {
  createEncryptedMetadataStore,
  type ControlPlaneData
} from "./encrypted-store.js";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));

const metadataStore = createEncryptedMetadataStore({
  dataDir:
    process.env.CONTROL_PLANE_DATA_DIR ??
    join(process.cwd(), ".atlas-meridian-control-plane"),
  encryptionKey: process.env.CONTROL_PLANE_ENCRYPTION_KEY
});
const memoryDb: ControlPlaneData = metadataStore.load();

function persistMetadata(): void {
  metadataStore.save(memoryDb);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "control-plane",
    encryptionAtRest: true,
    dataPath: metadataStore.getDataPath()
  });
});

app.get("/orgs", (_req, res) => {
  res.json(memoryDb.orgs);
});

app.post("/orgs", (req, res) => {
  const org = { id: crypto.randomUUID(), name: String(req.body.name ?? "Unnamed") };
  memoryDb.orgs.push(org);
  persistMetadata();
  res.status(201).json(org);
});

app.get("/workspaces", (_req, res) => {
  res.json(memoryDb.workspaces);
});

app.post("/workspaces", (req, res) => {
  const workspace = {
    id: crypto.randomUUID(),
    orgId: String(req.body.orgId ?? ""),
    name: String(req.body.name ?? "workspace")
  };
  memoryDb.workspaces.push(workspace);
  persistMetadata();
  res.status(201).json(workspace);
});

app.get("/policies", (_req, res) => {
  res.json(memoryDb.policies);
});

app.post("/policies", (req, res) => {
  const policy = {
    id: crypto.randomUUID(),
    orgId: String(req.body.orgId ?? ""),
    payload: (req.body.payload ?? {}) as Record<string, unknown>
  };
  memoryDb.policies.push(policy);
  persistMetadata();
  res.status(201).json(policy);
});

app.get("/audit/events", (_req, res) => {
  res.json(memoryDb.auditEvents);
});

app.post("/audit/events", (req, res) => {
  const event = {
    id: crypto.randomUUID(),
    ...req.body,
    ts: new Date().toISOString()
  };
  memoryDb.auditEvents.push(event);
  persistMetadata();
  res.status(201).json(event);
});

app.get("/metrics", (_req, res) => {
  res.json(memoryDb.metrics);
});

app.post("/metrics", (req, res) => {
  const metric = {
    id: crypto.randomUUID(),
    ...req.body,
    ts: new Date().toISOString()
  };
  memoryDb.metrics.push(metric);
  persistMetadata();
  res.status(201).json(metric);
});

app.post("/auth/sso", (req, res) => {
  const provider = String(req.body.provider ?? "oidc");
  res.json({
    provider,
    status: "configured",
    note: "stub endpoint; integrate OIDC/SAML in enterprise module"
  });
});

app.get("/releases", (_req, res) => {
  res.json([
    { channel: "stable", version: "0.1.0", notes: "bootstrap release" },
    { channel: "beta", version: "0.2.0-beta.1", notes: "experimental features" }
  ]);
});

app.post("/admin/backup", (_req, res) => {
  const path = metadataStore.exportBackup();
  res.status(201).json({ path });
});

app.post("/admin/restore", (req, res) => {
  const path = String(req.body.path ?? "").trim();
  if (!path) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  const restored = metadataStore.importBackup(path);
  memoryDb.orgs = restored.orgs;
  memoryDb.workspaces = restored.workspaces;
  memoryDb.policies = restored.policies;
  memoryDb.auditEvents = restored.auditEvents;
  memoryDb.metrics = restored.metrics;
  persistMetadata();
  res.json({
    ok: true,
    counts: {
      orgs: memoryDb.orgs.length,
      workspaces: memoryDb.workspaces.length,
      policies: memoryDb.policies.length,
      auditEvents: memoryDb.auditEvents.length,
      metrics: memoryDb.metrics.length
    }
  });
});

const port = Number(process.env.CONTROL_PLANE_PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    process.stdout.write(`control-plane listening on :${port}\n`);
  });
}

export { app };
