import test from "node:test";
import assert from "node:assert/strict";
import { buildTickPayload } from "../src/worker.ts";

test("buildTickPayload keeps deterministic fields", () => {
  const payload = buildTickPayload("2026-01-01T00:00:00.000Z", false);
  assert.equal(payload.service, "worker-service");
  assert.equal(payload.ts, "2026-01-01T00:00:00.000Z");
  assert.equal(payload.database_url_set, false);
});
