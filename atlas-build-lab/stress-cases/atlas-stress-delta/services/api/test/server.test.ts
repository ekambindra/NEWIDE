import test from "node:test";
import assert from "node:assert/strict";
import { buildHealthPayload, buildRoutePayload } from "../src/server.ts";

test("buildHealthPayload returns expected shape", () => {
  const payload = buildHealthPayload(true);
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "api-service");
  assert.equal(payload.database_url_set, true);
});

test("buildRoutePayload returns service and route", () => {
  const payload = buildRoutePayload("/orders");
  assert.equal(payload.service, "api-service");
  assert.equal(payload.route, "/orders");
});
