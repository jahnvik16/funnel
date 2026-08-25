import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidTelegramBotTokenFormat,
  callTelegramApi,
  getBotInfo,
  setWebhook,
  sendMessage,
  generateWebhookSecret,
} from "./telegram";

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

const FAKE_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678";

type MockCall = { url: string; body: Record<string, unknown> };

// A fetch stand-in for "mocked Telegram API" tests — no network access, no
// real credentials needed. Records every call so tests can assert on the
// request shape (e.g. that setWebhook's body carries secret_token).
function mockFetch(
  handler: (call: MockCall) => { ok: boolean; result?: unknown; description?: string },
  calls: MockCall[] = [],
): typeof fetch {
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const call: MockCall = {
      url: String(url),
      body: init?.body ? JSON.parse(init.body as string) : {},
    };
    calls.push(call);
    const payload = handler(call);
    return { json: async () => payload } as Response;
  }) as typeof fetch;
  return fn;
}

test("getBotInfo returns the parsed bot info on success", async () => {
  const calls: MockCall[] = [];
  const fetchImpl = mockFetch(
    () => ({ ok: true, result: { id: 123, is_bot: true, first_name: "Bot", username: "acme_offers_bot" } }),
    calls,
  );

  const result = await getBotInfo(FAKE_TOKEN, fetchImpl);
  assert.deepEqual(result, {
    ok: true,
    result: { id: 123, is_bot: true, first_name: "Bot", username: "acme_offers_bot" },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/getMe$/);
});

test("getBotInfo surfaces Telegram's own error description on failure", async () => {
  const fetchImpl = mockFetch(() => ({ ok: false, description: "Unauthorized" }));
  const result = await getBotInfo(FAKE_TOKEN, fetchImpl);
  assert.deepEqual(result, { ok: false, description: "Unauthorized" });
});

test("callTelegramApi fails safely (not a thrown error) when the network call itself fails", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;

  const result = await callTelegramApi(FAKE_TOKEN, "getMe", undefined, fetchImpl);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.description, /Could not reach/);
});

// A hung Telegram API call must not hang its caller forever — the webhook
// route needs to respond to Telegram promptly, and the admin's synchronous
// "Validate" action shouldn't spin indefinitely if Telegram is unreachable.
// This doesn't wait out a real timeout (too slow for a unit test); it proves
// callTelegramApi passes an abort signal at all, and that an abort is
// handled as an ordinary failure rather than an uncaught rejection.
test("callTelegramApi passes an abort signal, and treats an abort like any other network failure", async () => {
  let sawSignal = false;
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    sawSignal = init?.signal instanceof AbortSignal;
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as typeof fetch;

  const result = await callTelegramApi(FAKE_TOKEN, "getMe", undefined, fetchImpl);
  assert.equal(sawSignal, true);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.description, /Could not reach/);
});

test("never logs the bot token, even on failure", async () => {
  const logged: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logged.push(args.map(String).join(" "));

  try {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await getBotInfo(FAKE_TOKEN, fetchImpl);
    await setWebhook(FAKE_TOKEN, "https://example.com/webhook", "secret", fetchImpl);
    await sendMessage(FAKE_TOKEN, 42, "hi", undefined, fetchImpl);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  for (const line of logged) {
    assert.ok(!line.includes(FAKE_TOKEN), `log line unexpectedly contained the bot token: ${line}`);
  }
});

test("setWebhook sends the url and secret_token in the request body", async () => {
  const calls: MockCall[] = [];
  const fetchImpl = mockFetch(() => ({ ok: true, result: true }), calls);

  const result = await setWebhook(FAKE_TOKEN, "https://example.com/webhook/abc", "my-secret", fetchImpl);
  assert.deepEqual(result, { ok: true, result: true });
  assert.equal(calls[0].body.url, "https://example.com/webhook/abc");
  assert.equal(calls[0].body.secret_token, "my-secret");
});

test("sendMessage includes an inline keyboard CTA button when provided", async () => {
  const calls: MockCall[] = [];
  const fetchImpl = mockFetch(() => ({ ok: true, result: {} }), calls);

  await sendMessage(FAKE_TOKEN, 42, "Welcome!", { label: "Continue", url: "https://example.com/out/click1" }, fetchImpl);

  assert.equal(calls[0].body.chat_id, 42);
  assert.equal(calls[0].body.text, "Welcome!");
  assert.deepEqual(calls[0].body.reply_markup, {
    inline_keyboard: [[{ text: "Continue", url: "https://example.com/out/click1" }]],
  });
});

test("sendMessage omits reply_markup entirely when no CTA is given", async () => {
  const calls: MockCall[] = [];
  const fetchImpl = mockFetch(() => ({ ok: true, result: {} }), calls);

  await sendMessage(FAKE_TOKEN, 42, "Just a message", undefined, fetchImpl);

  assert.equal("reply_markup" in calls[0].body, false);
});

test("generateWebhookSecret produces a unique, header-safe value each time", () => {
  const a = generateWebhookSecret();
  const b = generateWebhookSecret();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 32);
});
