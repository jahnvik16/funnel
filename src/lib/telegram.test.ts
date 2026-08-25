import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTelegramBotTokenFormat } from "./telegram";

test("accepts a well-formed token", () => {
  assert.equal(
    isValidTelegramBotTokenFormat("123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678"),
    true,
  );
});

test("rejects a token missing the colon", () => {
  assert.equal(isValidTelegramBotTokenFormat("123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678"), false);
});

test("rejects a token with a short secret segment", () => {
  assert.equal(isValidTelegramBotTokenFormat("123456789:short"), false);
});

test("rejects an empty string", () => {
  assert.equal(isValidTelegramBotTokenFormat(""), false);
});
