try {
  process.loadEnvFile();
} catch {
  // No .env present (e.g. CI with vars injected directly) — fine.
}

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import {
  parseCsv,
  validatePaybigRow,
  computeStorageKey,
  importPaybigCsv,
  type ValidatedPaybigRow,
} from "./paybig-import";

function unique(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

const cleanup: Array<() => Promise<unknown>> = [];
after(async () => {
  for (const fn of cleanup.reverse()) {
    await fn();
  }
  await prisma.$disconnect();
});

async function makeBrand() {
  const brand = await prisma.brand.create({ data: { name: unique("Brand"), slug: unique("brand") } });
  cleanup.push(() => prisma.brand.delete({ where: { id: brand.id } }));
  return brand;
}

async function makePlatform() {
  const platform = await prisma.platform.create({ data: { name: unique("Platform"), slug: unique("platform") } });
  cleanup.push(() => prisma.platform.delete({ where: { id: platform.id } }));
  return platform;
}

async function makeCampaign(brandId: string, platformId: string, slug = unique("campaign")) {
  const campaign = await prisma.campaign.create({
    data: { brandId, platformId, name: unique("Campaign"), slug, paybigUrl: "https://paybig.example/lane" },
  });
  cleanup.push(() => prisma.campaign.delete({ where: { id: campaign.id } }));
  return campaign;
}

async function deleteConversions(paybigConversionIds: string[]) {
  for (const id of paybigConversionIds) {
    await prisma.conversion.deleteMany({ where: { paybigConversionId: id } });
  }
}

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

test("parseCsv splits a simple CSV into header + row objects", () => {
  const { header, rows } = parseCsv(
    "conversion_id,conversion_time,campaign_slug,amount,currency\n" +
      "abc123,2026-08-01T12:00:00Z,spring-push,19.99,USD\n",
  );
  assert.deepEqual(header, ["conversion_id", "conversion_time", "campaign_slug", "amount", "currency"]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    conversion_id: "abc123",
    conversion_time: "2026-08-01T12:00:00Z",
    campaign_slug: "spring-push",
    amount: "19.99",
    currency: "USD",
  });
});

test("parseCsv handles quoted fields with embedded commas and escaped quotes", () => {
  const { rows } = parseCsv(
    'conversion_id,conversion_time,campaign_slug,amount,currency,note\n' +
      '1,2026-08-01T12:00:00Z,spring-push,19.99,USD,"hello, ""world"""\n',
  );
  assert.equal(rows[0].note, 'hello, "world"');
});

test("parseCsv tolerates CRLF line endings", () => {
  const { rows } = parseCsv(
    "conversion_id,conversion_time,campaign_slug,amount,currency\r\n" +
      "1,2026-08-01T12:00:00Z,spring-push,19.99,USD\r\n" +
      "2,2026-08-02T12:00:00Z,spring-push,5,USD\r\n",
  );
  assert.equal(rows.length, 2);
});

test("parseCsv returns no rows for a header-only file", () => {
  const { header, rows } = parseCsv("conversion_id,conversion_time,campaign_slug,amount,currency\n");
  assert.equal(header.length, 5);
  assert.equal(rows.length, 0);
});

test("parseCsv returns nothing for an empty file", () => {
  const { header, rows } = parseCsv("");
  assert.deepEqual(header, []);
  assert.deepEqual(rows, []);
});

// Excel-exported CSVs commonly prepend a UTF-8 BOM. Left in, it silently
// fuses onto the first header cell's name, so every row would report that
// column "missing" with no obvious hint why — a systemic, hard-to-diagnose
// failure rather than a crash.
test("parseCsv strips a leading UTF-8 BOM instead of fusing it onto the first header", () => {
  const BOM = String.fromCharCode(0xfeff);
  const { header, rows } = parseCsv(
    `${BOM}conversion_id,conversion_time,campaign_slug,amount,currency\n` +
      "abc123,2026-08-01T12:00:00Z,spring-push,19.99,USD\n",
  );
  assert.equal(header[0], "conversion_id");
  assert.equal(rows[0].conversion_id, "abc123");
});

// ---------------------------------------------------------------------------
// validatePaybigRow
// ---------------------------------------------------------------------------

const validRow = {
  conversion_id: "abc123",
  conversion_time: "2026-08-01T12:00:00Z",
  campaign_slug: "spring-push",
  amount: "19.99",
  currency: "usd",
};

test("validatePaybigRow accepts a fully-populated valid row", () => {
  const result = validatePaybigRow(validRow);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.conversionId, "abc123");
  assert.equal(result.data.campaignSlug, "spring-push");
  assert.equal(result.data.amount, "19.99");
  assert.equal(result.data.currency, "USD");
  assert.equal(result.data.occurredAt.toISOString(), "2026-08-01T12:00:00.000Z");
});

test("validatePaybigRow treats a missing conversion_id as valid (optional field)", () => {
  const result = validatePaybigRow({ ...validRow, conversion_id: "" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.conversionId, null);
});

test("validatePaybigRow rejects a missing campaign_slug", () => {
  const result = validatePaybigRow({ ...validRow, campaign_slug: "" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /campaign_slug/);
});

test("validatePaybigRow rejects a missing conversion_time", () => {
  const result = validatePaybigRow({ ...validRow, conversion_time: "" });
  assert.equal(result.ok, false);
});

test("validatePaybigRow rejects an unparseable conversion_time", () => {
  const result = validatePaybigRow({ ...validRow, conversion_time: "not-a-date" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /conversion_time/);
});

test("validatePaybigRow rejects a non-numeric amount", () => {
  const result = validatePaybigRow({ ...validRow, amount: "nineteen" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /amount/);
});

test("validatePaybigRow rejects a malformed currency code", () => {
  const result = validatePaybigRow({ ...validRow, currency: "US" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /currency/);
});

// ---------------------------------------------------------------------------
// computeStorageKey
// ---------------------------------------------------------------------------

function validated(overrides: Partial<ValidatedPaybigRow> = {}): ValidatedPaybigRow {
  return {
    conversionId: "abc123",
    occurredAt: new Date("2026-08-01T12:00:00Z"),
    campaignSlug: "spring-push",
    amount: "19.99",
    currency: "USD",
    raw: {},
    ...overrides,
  };
}

test("computeStorageKey uses conversion_id directly when present", () => {
  const { key, synthetic } = computeStorageKey(validated());
  assert.equal(key, "abc123");
  assert.equal(synthetic, false);
});

test("computeStorageKey falls back to a composite key when conversion_id is absent", () => {
  const { key, synthetic } = computeStorageKey(validated({ conversionId: null }));
  assert.equal(synthetic, true);
  assert.match(key, /^composite:spring-push\|/);
});

test("computeStorageKey's composite fallback is stable across repeated calls for identical rows", () => {
  const a = computeStorageKey(validated({ conversionId: null }));
  const b = computeStorageKey(validated({ conversionId: null }));
  assert.equal(a.key, b.key);
});

test("computeStorageKey's composite fallback differs when any component field differs", () => {
  const a = computeStorageKey(validated({ conversionId: null, campaignSlug: "spring-push" }));
  const b = computeStorageKey(validated({ conversionId: null, campaignSlug: "summer-push" }));
  assert.notEqual(a.key, b.key);
});

// ---------------------------------------------------------------------------
// importPaybigCsv (integration — real Postgres)
// ---------------------------------------------------------------------------

function csvOf(rows: string[]): string {
  return "conversion_id,conversion_time,campaign_slug,amount,currency\n" + rows.join("\n") + "\n";
}

test("importPaybigCsv creates a Conversion per valid row and matches campaigns by slug", async () => {
  const brand = await makeBrand();
  const platform = await makePlatform();
  const campaign = await makeCampaign(brand.id, platform.id);
  const idA = unique("conv");
  const idB = unique("conv");
  cleanup.push(() => deleteConversions([idA, idB]));

  const csv = csvOf([
    `${idA},2026-08-01T12:00:00Z,${campaign.slug},19.99,USD`,
    `${idB},2026-08-02T12:00:00Z,${campaign.slug},5,USD`,
  ]);

  const summary = await importPaybigCsv(prisma, csv);

  assert.equal(summary.totalRows, 2);
  assert.equal(summary.created, 2);
  assert.equal(summary.duplicates, 0);
  assert.equal(summary.matchedCampaigns, 2);
  assert.deepEqual(summary.invalid, []);
  assert.deepEqual(summary.unmatched, []);

  const rows = await prisma.conversion.findMany({ where: { paybigConversionId: { in: [idA, idB] } } });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.campaignId === campaign.id && r.brandId === brand.id));
});

test("importPaybigCsv reports malformed rows without failing the whole import", async () => {
  const brand = await makeBrand();
  const platform = await makePlatform();
  const campaign = await makeCampaign(brand.id, platform.id);
  const goodId = unique("conv");
  cleanup.push(() => deleteConversions([goodId]));

  const csv = csvOf([
    `${goodId},2026-08-01T12:00:00Z,${campaign.slug},19.99,USD`,
    `,2026-08-02T12:00:00Z,${campaign.slug},not-a-number,USD`,
  ]);

  const summary = await importPaybigCsv(prisma, csv);

  assert.equal(summary.created, 1);
  assert.equal(summary.invalid.length, 1);
  assert.equal(summary.invalid[0].rowNumber, 3);
  assert.match(summary.invalid[0].reason, /amount/);
});

test("importPaybigCsv deduplicates by conversion_id and never double-counts a repeated import", async () => {
  const brand = await makeBrand();
  const platform = await makePlatform();
  const campaign = await makeCampaign(brand.id, platform.id);
  const id = unique("conv");
  cleanup.push(() => deleteConversions([id]));

  const csv = csvOf([`${id},2026-08-01T12:00:00Z,${campaign.slug},19.99,USD`]);

  const first = await importPaybigCsv(prisma, csv);
  assert.equal(first.created, 1);
  assert.equal(first.duplicates, 0);

  const second = await importPaybigCsv(prisma, csv);
  assert.equal(second.created, 0);
  assert.equal(second.duplicates, 1);

  const rows = await prisma.conversion.findMany({ where: { paybigConversionId: id } });
  assert.equal(rows.length, 1);
});

test("importPaybigCsv deduplicates repeated imports even without conversion_id, via the composite key", async () => {
  const brand = await makeBrand();
  const platform = await makePlatform();
  const campaign = await makeCampaign(brand.id, platform.id);

  const csvNoIds =
    "conversion_time,campaign_slug,amount,currency\n" +
    `2026-08-03T12:00:00Z,${campaign.slug},7.50,USD\n`;

  const first = await importPaybigCsv(prisma, csvNoIds);
  assert.equal(first.created, 1);

  const created = await prisma.conversion.findMany({ where: { campaignId: campaign.id } });
  cleanup.push(() => deleteConversions(created.map((c) => c.paybigConversionId)));

  const second = await importPaybigCsv(prisma, csvNoIds);
  assert.equal(second.created, 0);
  assert.equal(second.duplicates, 1);
});

test("importPaybigCsv records an unmatched conversion (campaignId null) when campaign_slug matches nothing", async () => {
  const unknownSlug = unique("no-such-campaign");
  const id = unique("conv");
  cleanup.push(() => deleteConversions([id]));

  const csv = csvOf([`${id},2026-08-01T12:00:00Z,${unknownSlug},19.99,USD`]);
  const summary = await importPaybigCsv(prisma, csv);

  assert.equal(summary.created, 1);
  assert.equal(summary.matchedCampaigns, 0);
  assert.equal(summary.unmatched.length, 1);
  assert.equal(summary.unmatched[0].reason, "not_found");

  const row = await prisma.conversion.findUniqueOrThrow({ where: { paybigConversionId: id } });
  assert.equal(row.campaignId, null);
  assert.equal(row.brandId, null);
});

test("importPaybigCsv treats a slug shared by two brands' campaigns as ambiguous, not a guess", async () => {
  const brandA = await makeBrand();
  const brandB = await makeBrand();
  const platform = await makePlatform();
  const sharedSlug = unique("shared-slug");
  await makeCampaign(brandA.id, platform.id, sharedSlug);
  await makeCampaign(brandB.id, platform.id, sharedSlug);

  const id = unique("conv");
  cleanup.push(() => deleteConversions([id]));

  const csv = csvOf([`${id},2026-08-01T12:00:00Z,${sharedSlug},19.99,USD`]);
  const summary = await importPaybigCsv(prisma, csv);

  assert.equal(summary.created, 1);
  assert.equal(summary.unmatched.length, 1);
  assert.equal(summary.unmatched[0].reason, "ambiguous");

  const row = await prisma.conversion.findUniqueOrThrow({ where: { paybigConversionId: id } });
  assert.equal(row.campaignId, null);
});
