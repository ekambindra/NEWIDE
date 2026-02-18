import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";

export type ProjectBuilderTemplate = "node_microservices_postgres";

export type ProjectBuilderRequest = {
  workspaceRoot: string;
  projectName: string;
  outputDir?: string;
  template?: ProjectBuilderTemplate;
  actor?: string;
};

export type ProjectBuilderResult = {
  runId: string;
  template: ProjectBuilderTemplate;
  projectName: string;
  projectRoot: string;
  generatedAt: string;
  generatedFiles: string[];
  services: {
    api: boolean;
    worker: boolean;
    postgres: boolean;
  };
  completeness: {
    required: string[];
    present: string[];
    missing: string[];
    completenessPercent: number;
  };
  checkpointPath: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "atlas-meridian-template";
}

function sanitizePackageName(value: string): string {
  return slugify(value).replace(/-/g, "_");
}

function assertWithin(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === ".." || resolve(root, rel).startsWith("..")) {
    throw new Error("project builder target must stay within workspace root");
  }
}

async function ensureEmptyTarget(root: string): Promise<void> {
  if (!existsSync(root)) {
    await fs.mkdir(root, { recursive: true });
    return;
  }
  const entries = await fs.readdir(root);
  if (entries.length > 0) {
    throw new Error("target directory already exists and is not empty");
  }
}

async function writeText(path: string, value: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${normalizeLf(value)}\n`, "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requiredArtifacts(): string[] {
  return [
    "README.md",
    "ARCHITECTURE.md",
    "RUNBOOK.md",
    "SECURITY.md",
    "docker-compose.yml",
    ".env.example",
    ".github/workflows/ci.yml"
  ];
}

async function computeCompleteness(projectRoot: string): Promise<{
  required: string[];
  present: string[];
  missing: string[];
  completenessPercent: number;
}> {
  const required = requiredArtifacts();
  const present: string[] = [];
  const missing: string[] = [];
  for (const item of required) {
    const absolute = join(projectRoot, item);
    if (existsSync(absolute)) {
      present.push(item);
    } else {
      missing.push(item);
    }
  }
  const completenessPercent =
    required.length === 0 ? 100 : Math.round((present.length / required.length) * 1000) / 10;
  return {
    required,
    present,
    missing,
    completenessPercent
  };
}

function projectFiles(input: {
  projectName: string;
  packageSafeName: string;
}): Record<string, string> {
  const { projectName, packageSafeName } = input;
  return {
    "package.json": JSON.stringify(
      {
        name: packageSafeName,
        private: true,
        version: "0.1.0",
        workspaces: ["services/*"],
        scripts: {
          "dev:api": "npm run dev --workspace @template/api-service",
          "dev:worker": "npm run dev --workspace @template/worker-service",
          lint: "npm run lint --workspaces",
          test: "npm run test --workspaces",
          build: "npm run build --workspaces"
        }
      },
      null,
      2
    ),
    ".gitignore": "node_modules/\ndist/\n.env\n",
    ".env.example": [
      "POSTGRES_DB=atlas_meridian",
      "POSTGRES_USER=atlas",
      "POSTGRES_PASSWORD=atlas_pw",
      "DATABASE_URL=postgres://atlas:atlas_pw@localhost:5432/atlas_meridian",
      "API_PORT=4000",
      "WORKER_INTERVAL_MS=5000"
    ].join("\n"),
    "docker-compose.yml": [
      "services:",
      "  postgres:",
      "    image: postgres:16",
      "    restart: unless-stopped",
      "    environment:",
      "      POSTGRES_DB: ${POSTGRES_DB}",
      "      POSTGRES_USER: ${POSTGRES_USER}",
      "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}",
      "    ports:",
      "      - \"5432:5432\"",
      "    volumes:",
      "      - ./db/init:/docker-entrypoint-initdb.d",
      "",
      "  api:",
      "    image: node:22",
      "    working_dir: /workspace",
      "    command: sh -lc \"npm install && npm run dev --workspace @template/api-service\"",
      "    environment:",
      "      DATABASE_URL: ${DATABASE_URL}",
      "      API_PORT: ${API_PORT}",
      "    ports:",
      "      - \"4000:4000\"",
      "    volumes:",
      "      - ./:/workspace",
      "    depends_on:",
      "      - postgres",
      "",
      "  worker:",
      "    image: node:22",
      "    working_dir: /workspace",
      "    command: sh -lc \"npm install && npm run dev --workspace @template/worker-service\"",
      "    environment:",
      "      DATABASE_URL: ${DATABASE_URL}",
      "      WORKER_INTERVAL_MS: ${WORKER_INTERVAL_MS}",
      "    volumes:",
      "      - ./:/workspace",
      "    depends_on:",
      "      - postgres"
    ].join("\n"),
    "README.md": [
      `# ${projectName}`,
      "",
      "Node microservices + Postgres template generated by Atlas Meridian.",
      "",
      "## Services",
      "- `services/api`: HTTP API service",
      "- `services/worker`: background worker",
      "- `db/init`: Postgres bootstrap SQL",
      "",
      "## Local Run",
      "1. Copy `.env.example` to `.env`.",
      "2. Run `docker compose up`.",
      "3. Verify `GET http://localhost:4000/health`."
    ].join("\n"),
    "ARCHITECTURE.md": [
      "# Architecture",
      "",
      "- API service handles synchronous requests and exposes health endpoints.",
      "- Worker service runs periodic jobs and writes structured logs.",
      "- Postgres provides durable state with bootstrap schema in `db/init`."
    ].join("\n"),
    "RUNBOOK.md": [
      "# Runbook",
      "",
      "## Startup",
      "- `docker compose up -d`",
      "",
      "## Health",
      "- API: `curl http://localhost:4000/health`",
      "- Worker: inspect container logs for tick output.",
      "",
      "## Recovery",
      "- Restart failing service: `docker compose restart <service>`",
      "- Reinitialize DB: remove volume and re-run compose."
    ].join("\n"),
    "SECURITY.md": [
      "# Security",
      "",
      "- Secrets are configured through environment variables only.",
      "- No credentials are committed; `.env.example` is non-sensitive.",
      "- Production hardening should enforce network policy and secret rotation."
    ].join("\n"),
    ".github/workflows/ci.yml": [
      "name: ci",
      "on:",
      "  push:",
      "  pull_request:",
      "",
      "jobs:",
      "  validate:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 22",
      "      - run: npm ci",
      "      - run: npm run lint",
      "      - run: npm run test",
      "      - run: npm run build"
    ].join("\n"),
    "db/init/001_init.sql": [
      "CREATE TABLE IF NOT EXISTS jobs (",
      "  id BIGSERIAL PRIMARY KEY,",
      "  name TEXT NOT NULL,",
      "  status TEXT NOT NULL DEFAULT 'queued',",
      "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      ");",
      "",
      "CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);"
    ].join("\n"),
    "services/api/package.json": JSON.stringify(
      {
        name: "@template/api-service",
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "tsx src/server.ts",
          build: "tsc -p tsconfig.json",
          lint: "tsc -p tsconfig.json --noEmit",
          test: "node --test"
        },
        dependencies: {},
        devDependencies: {
          typescript: "^5.8.2",
          tsx: "^4.20.5"
        }
      },
      null,
      2
    ),
    "services/api/tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          strict: true,
          types: ["node"]
        },
        include: ["src/**/*.ts"]
      },
      null,
      2
    ),
    "services/api/src/server.ts": [
      "import { createServer } from \"node:http\";",
      "",
      "const port = Number(process.env.API_PORT ?? 4000);",
      "const service = \"api-service\";",
      "",
      "const server = createServer((req, res) => {",
      "  if (req.url === \"/health\") {",
      "    const payload = {",
      "      status: \"ok\",",
      "      service,",
      "      database_url_set: Boolean(process.env.DATABASE_URL)",
      "    };",
      "    res.writeHead(200, { \"content-type\": \"application/json\" });",
      "    res.end(JSON.stringify(payload));",
      "    return;",
      "  }",
      "",
      "  res.writeHead(200, { \"content-type\": \"application/json\" });",
      "  res.end(JSON.stringify({",
      "    service,",
      "    route: req.url ?? \"/\"",
      "  }));",
      "});",
      "",
      "server.listen(port, () => {",
      "  console.log(`[api-service] listening on ${port}`);",
      "});"
    ].join("\n"),
    "services/worker/package.json": JSON.stringify(
      {
        name: "@template/worker-service",
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "tsx src/worker.ts",
          build: "tsc -p tsconfig.json",
          lint: "tsc -p tsconfig.json --noEmit",
          test: "node --test"
        },
        dependencies: {},
        devDependencies: {
          typescript: "^5.8.2",
          tsx: "^4.20.5"
        }
      },
      null,
      2
    ),
    "services/worker/tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          strict: true,
          types: ["node"]
        },
        include: ["src/**/*.ts"]
      },
      null,
      2
    ),
    "services/worker/src/worker.ts": [
      "const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);",
      "",
      "function tick(): void {",
      "  console.log(JSON.stringify({",
      "    service: \"worker-service\",",
      "    ts: new Date().toISOString(),",
      "    database_url_set: Boolean(process.env.DATABASE_URL)",
      "  }));",
      "}",
      "",
      "tick();",
      "setInterval(tick, intervalMs);"
    ].join("\n")
  };
}

function patchDiffFromFiles(files: string[]): string {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(`diff --git a/${file} b/${file}`);
    lines.push("new file mode 100644");
    lines.push("--- /dev/null");
    lines.push(`+++ b/${file}`);
    lines.push("@@ -0,0 +1 @@");
    lines.push(`+generated by atlas-meridian builder (${file})`);
  }
  return lines.join("\n");
}

export async function buildProjectTemplate(input: {
  request: ProjectBuilderRequest;
  checkpointRoot: string;
}): Promise<ProjectBuilderResult> {
  const template: ProjectBuilderTemplate = input.request.template ?? "node_microservices_postgres";
  if (template !== "node_microservices_postgres") {
    throw new Error(`unsupported template: ${template}`);
  }

  const projectName = input.request.projectName.trim() || "Atlas Meridian Service Stack";
  const slug = slugify(projectName);
  const outputDir = input.request.outputDir?.trim() || `generated-projects/${slug}`;
  const projectRoot = resolve(input.request.workspaceRoot, outputDir);
  assertWithin(input.request.workspaceRoot, projectRoot);
  await ensureEmptyTarget(projectRoot);

  const packageSafeName = sanitizePackageName(projectName);
  const files = projectFiles({
    projectName,
    packageSafeName
  });
  const generatedFiles = Object.keys(files).sort();

  for (const relPath of generatedFiles) {
    await writeText(join(projectRoot, relPath), files[relPath] ?? "");
  }

  const completeness = await computeCompleteness(projectRoot);
  const runId = `builder-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runRoot = join(input.checkpointRoot, runId);
  const stepRoot = join(runRoot, "step-1");
  const generatedAt = nowIso();

  await writeJson(join(runRoot, "manifest.json"), {
    run_id: runId,
    task_type: "project_builder",
    repo_snapshot: "workspace",
    model: "desktop-template-builder",
    policy_version: "balanced-v1",
    started_at: generatedAt,
    ended_at: generatedAt,
    final_status: "success"
  });
  await writeJson(join(stepRoot, "plan.json"), {
    run_id: runId,
    step_id: "step-1",
    goal: `build template project ${projectName}`,
    acceptance_criteria: [
      "api service scaffold generated",
      "worker service scaffold generated",
      "postgres integration scaffold generated",
      "required artifacts generated"
    ],
    risks: ["target overwrite", "template drift"],
    policy_context: {
      mode: "balanced",
      template,
      output_dir: outputDir
    },
    deterministic_seed: slug
  });
  await fs.mkdir(stepRoot, { recursive: true });
  await fs.writeFile(join(stepRoot, "patch.diff"), `${patchDiffFromFiles(generatedFiles)}\n`, "utf8");
  await fs.writeFile(
    join(stepRoot, "tool_calls.jsonl"),
    `${JSON.stringify({
      id: randomUUID(),
      step_id: "step-1",
      tool: "project_builder",
      args: {
        template,
        project_name: projectName,
        output_dir: outputDir
      },
      started_at: generatedAt,
      ended_at: generatedAt,
      exit_code: 0,
      status: "success",
      output_ref: null
    })}\n`,
    "utf8"
  );
  await writeJson(join(stepRoot, "results.json"), {
    status: "success",
    checks: {
      lint: "skip",
      typecheck: "skip",
      test: "skip",
      build: "skip"
    },
    failures: [],
    metrics: {
      generated_files: generatedFiles.length,
      completeness_percent: completeness.completenessPercent
    },
    next_action: null
  });
  await writeJson(join(runRoot, "project_builder_bundle.json"), {
    run_id: runId,
    template,
    project_name: projectName,
    project_root: projectRoot,
    output_dir: outputDir,
    generated_at: generatedAt,
    generated_files: generatedFiles,
    completeness
  });

  return {
    runId,
    template,
    projectName,
    projectRoot,
    generatedAt,
    generatedFiles,
    services: {
      api: generatedFiles.some((item) => item.startsWith("services/api/")),
      worker: generatedFiles.some((item) => item.startsWith("services/worker/")),
      postgres: generatedFiles.some((item) => item.startsWith("db/init/"))
    },
    completeness,
    checkpointPath: runRoot
  };
}
