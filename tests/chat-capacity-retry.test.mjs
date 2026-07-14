import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MODEL_CAPACITY_CONTINUE_PROMPT,
  MODEL_CAPACITY_RETRY_LIMIT,
  isModelCapacityError,
  modelCapacityRetryDelayMs,
  modelCapacityRetryPrompt,
} from "../src/chat/capacity.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/chat.rs", import.meta.url), "utf8");

test("reconnait une saturation de modele sans la confondre avec le quota", () => {
  assert.equal(
    isModelCapacityError("Selected model is at capacity. Please try a different model."),
    true,
  );
  assert.equal(isModelCapacityError("The requested model is currently overloaded"), true);
  assert.equal(isModelCapacityError("You've hit your usage limit. Try again later."), false);
  assert.equal(isModelCapacityError("CST node capacity reached"), false);
  assert.equal(isModelCapacityError("Maximum context length exceeded"), false);
});

test("espace trois reprises automatiques avec un backoff borne", () => {
  assert.equal(MODEL_CAPACITY_RETRY_LIMIT, 3);
  assert.deepEqual([1, 2, 3, 4].map(modelCapacityRetryDelayMs), [3_000, 6_000, 12_000, 12_000]);
});

test("continue la session existante et rejoue seulement une session jamais creee", () => {
  assert.equal(MODEL_CAPACITY_CONTINUE_PROMPT, "continue");
  assert.equal(modelCapacityRetryPrompt("session-id", "demande initiale"), "continue");
  assert.equal(modelCapacityRetryPrompt(null, "demande initiale"), "demande initiale");
});

test("les deux interfaces reessaient avec le modele exact du tour", () => {
  assert.match(main, /scheduleMainModelCapacityRetry/);
  assert.match(main, /scheduleExpertModelCapacityRetry/);
  assert.match(main, /model: activeSubmission\.model/);
  assert.match(main, /reasoningEffort: activeSubmission\.reasoningEffort/);
  assert.match(main, /modelCapacityRetryPrompt\(resumeSessionId, activeSubmission\.prompt\)/);
  assert.match(backend, /is_model_capacity_message/);
});
