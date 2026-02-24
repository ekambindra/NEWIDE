import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuess, isValidGuess, resolveSecret } from "../src/engine.js";

test("isValidGuess validates game bounds", () => {
  assert.equal(isValidGuess(1), true);
  assert.equal(isValidGuess(20), true);
  assert.equal(isValidGuess(0), false);
  assert.equal(isValidGuess(21), false);
  assert.equal(isValidGuess(7.2), false);
});

test("evaluateGuess returns directional hints", () => {
  assert.equal(evaluateGuess(10, 10), "correct");
  assert.equal(evaluateGuess(10, 4), "low");
  assert.equal(evaluateGuess(10, 17), "high");
});

test("resolveSecret honors forced env secret", () => {
  assert.equal(resolveSecret(() => 0.99, "12"), 12);
  assert.equal(resolveSecret(() => 0, "invalid"), 1);
  assert.equal(resolveSecret(() => 0.5, undefined), 11);
});
