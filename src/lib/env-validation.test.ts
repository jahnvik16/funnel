import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnv, EnvValidationError } from "./env-validation";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");

function baseEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    ENCRYPTION_KEY: VALID_KEY,
    APP_BASE_URL: "https://example.com",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test("validateEnv passes for a fully-populated, valid environment", () => {
  assert.doesNotThrow(() => validateEnv(baseEnv()));
});

test("validateEnv throws when DATABASE_URL is missing", () => {
  const env = baseEnv();
  delete env.DATABASE_URL;
  assert.throws(() => validateEnv(env), EnvValidationError);
});

test("validateEnv throws when ENCRYPTION_KEY is missing", () => {
  const env = baseEnv();
  delete env.ENCRYPTION_KEY;
  assert.throws(() => validateEnv(env), EnvValidationError);
});

test("validateEnv throws when ENCRYPTION_KEY does not decode to exactly 32 bytes", () => {
  assert.throws(
    () => validateEnv(baseEnv({ ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") })),
    EnvValidationError,
  );
});

test("validateEnv reports every missing required variable, not just the first", () => {
  const env = baseEnv();
  delete env.DATABASE_URL;
  delete env.ENCRYPTION_KEY;
  try {
    validateEnv(env);
    assert.fail("expected validateEnv to throw");
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    assert.match(error.message, /DATABASE_URL/);
    assert.match(error.message, /ENCRYPTION_KEY/);
  }
});

test("validateEnv does not throw when APP_BASE_URL is missing — it's a soft requirement", () => {
  const env = baseEnv();
  delete env.APP_BASE_URL;
  assert.doesNotThrow(() => validateEnv(env));
});
