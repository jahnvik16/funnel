import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDatabaseHealth, type QueryableDb } from "./health";

test("checkDatabaseHealth returns 'connected' when the query succeeds", async () => {
  const fakeDb: QueryableDb = {
    $queryRaw: async <T>() => [{ "?column?": 1 }] as T,
  };
  assert.equal(await checkDatabaseHealth(fakeDb), "connected");
});

test("checkDatabaseHealth returns 'unreachable' when the query throws, without rethrowing", async () => {
  const fakeDb: QueryableDb = {
    $queryRaw: async () => {
      throw new Error("connection refused");
    },
  };
  await assert.doesNotReject(async () => {
    const result = await checkDatabaseHealth(fakeDb);
    assert.equal(result, "unreachable");
  });
});
