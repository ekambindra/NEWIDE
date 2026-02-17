import express from "express";
import helmet from "helmet";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));

const memoryDb = {
  orgs: [] as Array<{ id: string; name: string }>,
  workspaces: [] as Array<{ id: string; orgId: string; name: string }>,
  policies: [] as Array<{ id: string; orgId: string; payload: Record<string, unknown> }>,
  auditEvents: [] as Array<Record<string, unknown>>,
  metrics: [] as Array<Record<string, unknown>>
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "control-plane" });
});

app.get("/orgs", (_req, res) => {
  res.json(memoryDb.orgs);
});

app.post("/orgs", (req, res) => {
  const org = { id: crypto.randomUUID(), name: String(req.body.name ?? "Unnamed") };
  memoryDb.orgs.push(org);
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

const port = Number(process.env.CONTROL_PLANE_PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    process.stdout.write(`control-plane listening on :${port}\n`);
  });
}

export { app };
