import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateRequestId } from "./request-context";

test("getOrCreateRequestId reuses an upstream x-request-id header when present", () => {
  const headers = new Headers({ "x-request-id": "upstream-id-123" });
  assert.equal(getOrCreateRequestId(headers), "upstream-id-123");
});

test("getOrCreateRequestId generates a fresh id when no header is present", () => {
  const id = getOrCreateRequestId(new Headers());
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
});

test("getOrCreateRequestId generates different ids across calls with no header", () => {
  const a = getOrCreateRequestId(new Headers());
  const b = getOrCreateRequestId(new Headers());
  assert.notEqual(a, b);
});
