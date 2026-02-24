# Atlas Meridian Beginner Guide

This guide is for users with zero prior experience.
It explains how to open Atlas Meridian, use each major area of the app, and build a website end-to-end.

## 1. What Atlas Meridian Is

Atlas Meridian is a desktop AI IDE for building software projects with:

- file editing,
- terminal/test pipelines,
- diff approvals and checkpoints,
- project generation (Node microservices + Postgres),
- indexing, refactors, review tools, and governance controls.

## 2. What You Need Before Starting

Install these on your machine:

1. Node.js `22.x` and `npm`
2. Git
3. Docker Desktop (optional, recommended for Postgres/microservices)

If you are running from source:

1. Open terminal in the repository root.
2. Run `npm install`.
3. Start the app with `npm run dev:desktop`.

## 3. First Launch Checklist

When the app opens:

1. Click `Open` in the top bar.
2. Select your workspace folder.
3. Use the `Ask Atlas` command bar (top center) for almost everything.
4. Keep `Basic` mode on by default; switch to `Advanced` only when you need deep controls.
4. If you see preload warning UI:
   - click `Retry Bridge Check`,
   - if needed click `Reload UI`.

## 4. Simplified Workflow (Codex/Cursor Style)

Use one command box at the top:

- Type request in `Ask Atlas`
- Press `Send`
- Review output in `Agent` / `Terminal` / `Logs`
- If a workspace is required and not open, Atlas prompts/open-dialogs for one.
- If your text is not a slash command, Atlas routes it to agent execution automatically.
- Press `Tab` to accept a command suggestion from the dropdown.
- Use `Arrow Up` / `Arrow Down` to recall recent prompt history.
- Prompt history is persisted and available after restart.
- Hover the `/` helper button in the prompt row to see a slash-command cheat sheet.
- Watch `Agent -> Live Agent Progress` for freeform-task routing and execution updates.
- Use top `Quick Commands` chips for one-click actions (`Open`, `Run Tests`, `Pipeline`, `Build Stack`, `Diff`, `Checkpoints`).
- Pin/unpin quick commands with the star button so favorites stay first.
- Check top-right run badge (`IDLE`, `RUNNING`, `BLOCKED`) for current execution state.
- If a freeform request is running, use `Cancel Freeform` in the top bar to request cancellation.

Recommended command shortcuts:

```text
/help
/open
/search auth middleware
/run npm run test
/pipeline
/build My Website Backend
/refactor oldName newName
/agent
/plan
/diff
/checkpoints
```

Natural language also works for common actions, for example:

- `build website`
- `run tests`
- `open workspace`
- `find auth middleware in src`
- `refactor runTask to executeTask`
- `show diff`

## 5. UI Map (Simple Explanation)

1. `Files`
- Browse folders and open files.

2. `Search`
- Search text across the project.

3. `Editor`
- Main code editor.
- Supports single/split view and save.

4. `Agent`
- Project Builder, Multi-Agent mode, and Multi-file Refactor mode.

5. `Plan`
- Enterprise tools: auth, control-plane, benchmark dashboard, audit, reviewer, memory, decision logs.

6. `Diff`
- Review edits by chunk and accept/reject changes.

7. `Checkpoints`
- Inspect saved run artifacts and replay terminal history.

8. `Terminal`, `Tests`, `Logs`
- Run commands, pipeline checks, and inspect app/runtime logs.

## 6. Fastest Path: Build Your First Website

Use this exact flow.

### Step A: Create a website project folder

1. Create a workspace folder on disk, for example `my-first-site`.
2. In Atlas Meridian, click `Open` and select `my-first-site`.

### Step B: Scaffold a React website

1. Click `Terminal`.
2. Run:

```bash
npm create vite@latest web -- --template react-ts
cd web
npm install
npm run dev
```

3. Open the local URL shown in terminal (usually `http://localhost:5173`).

### Step C: Edit website content

1. Click `Files`.
2. Open `/web/src/App.tsx`.
3. Replace starter content with your page sections (hero, features, contact).
4. Save and confirm browser hot reload.

### Step D: Add a second page

1. In terminal, install router:

```bash
cd web
npm install react-router-dom
```

2. Create page files in `/web/src/`.
3. Update routes in your app.
4. Test navigation in browser.

### Step E: Run quality checks

1. In `Terminal`, run:

```bash
cd web
npm run build
```

2. If you add tests, run:

```bash
npm test
```

## 7. Build a Full Website + Backend Stack

If you want an API/database with your website:

### Step A: Generate backend services from Atlas Meridian

1. Click `Agent`.
2. In `Project Builder (Node Microservices + Postgres)`:
   - set Project name,
   - set Output directory (example: `backend`),
   - click `Build Template`.

This generates API + worker + Postgres scaffolding, docs, CI, and compose files.

### Step B: Create frontend in same workspace

1. Use `Terminal` to scaffold frontend in `frontend`:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm run dev
```

2. Keep API service in `backend/services/api`.
3. Use frontend fetch calls to hit API endpoints (example: `/health`).

### Step C: Run backend locally with Docker

```bash
cd backend
cp .env.example .env
docker compose up
```

### Step D: Verify integration

1. Check API health endpoint.
2. Confirm frontend can read API response.

## 8. Use Diff + Checkpoints Safely

When changes are large:

1. Open `Diff`.
2. Review chunk-by-chunk.
3. Accept/reject chunks with rationale.
4. Apply queue.
5. Open `Checkpoints` to inspect saved artifacts and revert if needed.

## 9. Use Multi-File Refactor

For safe renames:

1. Open `Agent`.
2. In `Multi-file Refactor Mode`:
   - set `Rename from`,
   - set `Rename to`,
   - set max files,
   - start with `Preview only`.
3. Review output, then run actual apply.

## 10. Testing and Validation Commands

In project root, common commands:

```bash
npm run lint
npm run test
npm run build
```

For Atlas Meridian full validation:

```bash
./scripts/full-validation.sh
./scripts/heavy-test.sh
```

## 11. Publishing a Website

For frontend-only websites:

1. Build:

```bash
cd web
npm run build
```

2. Deploy `dist/` to Netlify, Vercel, S3+CloudFront, or similar static host.

For full-stack (frontend + backend):

1. Deploy frontend static build.
2. Deploy backend services and database separately.
3. Configure frontend API base URL.

## 12. Troubleshooting

1. App UI not ready (`preload` message):
- Use `Retry Bridge Check` then `Reload UI`.

2. Port already in use:
- Stop prior dev process and rerun.

3. Build fails:
- Run `npm install`.
- Run `npm run lint` and fix shown errors.

4. Docker issues:
- Ensure Docker Desktop is running.
- Recreate containers with `docker compose down` then `docker compose up`.

## 13. Recommended New User Workflow

1. Start with a small static website.
2. Add routing and forms.
3. Add backend from Project Builder.
4. Connect frontend to API.
5. Use `Diff` and `Checkpoints` before major changes.
6. Run validation commands before publishing.

## 14. Quick Copy/Paste Starter Prompt for a New User

Use this in your own planning notes while building:

```text
Goal: Build a simple production-ready website with homepage, features page, contact form, and responsive layout.
Constraints: TypeScript, React, clean folder structure, no broken lint/build.
Steps:
1) Scaffold project.
2) Build pages and navigation.
3) Add reusable components and styling.
4) Add basic tests.
5) Run lint/test/build and fix issues.
6) Produce deployment-ready build output.
```
