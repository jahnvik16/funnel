import { Prisma } from "@prisma/client";

// Framework-independent (no next/headers) so it's directly testable — same
// split as lib/tracking-link-publishing.ts and lib/public-routing.ts.
type Db = Prisma.TransactionClient;

export type CsvRow = Record<string, string>;

// Minimal RFC4180-style tokenizer: quoted fields, embedded commas/newlines,
// "" as an escaped quote. Paybig's CSV export is a small, well-defined shape
// (five required columns, no exotic dialect), so a hand-rolled parser avoids
// pulling in a dependency for something this bounded and test-covered.
function tokenizeCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a leading UTF-8 BOM — common in Excel-exported CSVs. Left in
  // place, it silently fuses onto the first header cell's name (e.g.
  // "﻿conversion_time"), so every row would report that column
  // "missing" without any obviously-wrong symptom to point at why.
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const text = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function parseCsv(content: string): { header: string[]; rows: CsvRow[] } {
  const tokenized = tokenizeCsv(content);
  if (tokenized.length === 0) return { header: [], rows: [] };

  const header = tokenized[0].map((h) => h.trim());
  const rows = tokenized.slice(1).map((cells) => {
    const row: CsvRow = {};
    header.forEach((key, i) => {
      row[key] = (cells[i] ?? "").trim();
    });
    return row;
  });

  return { header, rows };
}

export type ValidatedPaybigRow = {
  conversionId: string | null;
  occurredAt: Date;
  campaignSlug: string;
  amount: string;
  currency: string;
  raw: CsvRow;
};

export type RowValidationResult =
  | { ok: true; data: ValidatedPaybigRow }
  | { ok: false; reason: string };

const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

// The five minimum fields from the milestone brief. conversion_id is the only
// one that's optional at the row level — see computeStorageKey for what
// happens when it's missing.
export function validatePaybigRow(row: CsvRow): RowValidationResult {
  const campaignSlug = row.campaign_slug?.trim();
  if (!campaignSlug) return { ok: false, reason: "Missing campaign_slug." };

  const conversionTimeRaw = row.conversion_time?.trim();
  if (!conversionTimeRaw) return { ok: false, reason: "Missing conversion_time." };
  const occurredAt = new Date(conversionTimeRaw);
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, reason: `Invalid conversion_time: "${conversionTimeRaw}".` };
  }

  const amountRaw = row.amount?.trim();
  if (!amountRaw) return { ok: false, reason: "Missing amount." };
  if (!AMOUNT_PATTERN.test(amountRaw)) {
    return { ok: false, reason: `Invalid amount: "${amountRaw}".` };
  }

  const currencyRaw = row.currency?.trim();
  if (!currencyRaw || !CURRENCY_PATTERN.test(currencyRaw)) {
    return { ok: false, reason: `Invalid currency: "${row.currency ?? ""}".` };
  }

  const conversionIdRaw = row.conversion_id?.trim();

  return {
    ok: true,
    data: {
      conversionId: conversionIdRaw ? conversionIdRaw : null,
      occurredAt,
      campaignSlug,
      amount: amountRaw,
      currency: currencyRaw.toUpperCase(),
      raw: row,
    },
  };
}

export type StorageKey = { key: string; synthetic: boolean };

// Prefer the real conversion_id as the dedup key (matches
// Conversion.paybigConversionId's unique constraint directly). When it's
// absent, fall back to a composite key built from the other required fields.
//
// LIMITATION (see DECISIONS.md D027 and OPEN_QUESTIONS.md): two genuinely
// distinct conversions that happen to share campaign_slug, conversion_time
// (to the exact string Paybig sent), amount, and currency are
// indistinguishable under this fallback and will collide — the second is
// treated as a duplicate and dropped rather than double-counted. This is a
// deliberate "never double-count" bias: an occasional false-duplicate is
// preferable to systematically inflating signup counts on repeated imports.
export function computeStorageKey(data: ValidatedPaybigRow): StorageKey {
  if (data.conversionId) {
    return { key: data.conversionId, synthetic: false };
  }
  const key = `composite:${data.campaignSlug}|${data.occurredAt.toISOString()}|${data.amount}|${data.currency}`;
  return { key, synthetic: true };
}

export type CampaignMatchResult =
  | { status: "matched"; campaignId: string; brandId: string }
  | { status: "not_found" }
  | { status: "ambiguous"; candidateCount: number };

// Campaign.slug is unique per brand, not globally (@@unique([brandId, slug])),
// so a bare campaign_slug can legitimately match more than one campaign
// across different brands. Rather than guess which brand's campaign a row
// belongs to, an ambiguous match is treated the same as "not found" for
// attribution purposes — see DECISIONS.md D028.
async function matchCampaign(db: Db, campaignSlug: string): Promise<CampaignMatchResult> {
  const candidates = await db.campaign.findMany({
    where: { slug: campaignSlug },
    select: { id: true, brandId: true },
  });
  if (candidates.length === 0) return { status: "not_found" };
  if (candidates.length > 1) return { status: "ambiguous", candidateCount: candidates.length };
  return { status: "matched", campaignId: candidates[0].id, brandId: candidates[0].brandId };
}

export type InvalidRow = { rowNumber: number; reason: string; raw: CsvRow };
export type UnmatchedRow = {
  rowNumber: number;
  campaignSlug: string;
  reason: "not_found" | "ambiguous";
};

export type ImportSummary = {
  totalRows: number;
  created: number;
  duplicates: number;
  matchedCampaigns: number;
  invalid: InvalidRow[];
  unmatched: UnmatchedRow[];
};

// Row-by-row rather than one big transaction: a CSV can be large, and one bad
// row (or one duplicate) should never block the rest of the file from
// importing. Never claims a real Paybig signup and drops it just because
// attribution failed — CLAUDE.md rule 8 ("Paybig is authoritative for
// signups") — so an unmatched row still creates a Conversion, with
// campaignId/brandId left null and the raw row preserved in rawPayload for
// diagnosis.
export async function importPaybigCsv(db: Db, csvContent: string): Promise<ImportSummary> {
  const { rows } = parseCsv(csvContent);

  const summary: ImportSummary = {
    totalRows: rows.length,
    created: 0,
    duplicates: 0,
    matchedCampaigns: 0,
    invalid: [],
    unmatched: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for 1-indexing, +1 for the header row
    const validated = validatePaybigRow(rows[i]);
    if (!validated.ok) {
      summary.invalid.push({ rowNumber, reason: validated.reason, raw: rows[i] });
      continue;
    }

    const { key } = computeStorageKey(validated.data);
    const existing = await db.conversion.findUnique({ where: { paybigConversionId: key } });
    if (existing) {
      summary.duplicates++;
      continue;
    }

    const match = await matchCampaign(db, validated.data.campaignSlug);
    let campaignId: string | null = null;
    let brandId: string | null = null;
    if (match.status === "matched") {
      campaignId = match.campaignId;
      brandId = match.brandId;
      summary.matchedCampaigns++;
    } else {
      summary.unmatched.push({
        rowNumber,
        campaignSlug: validated.data.campaignSlug,
        reason: match.status,
      });
    }

    try {
      await db.conversion.create({
        data: {
          paybigConversionId: key,
          campaignId,
          brandId,
          amount: validated.data.amount,
          currency: validated.data.currency,
          occurredAt: validated.data.occurredAt,
          rawPayload: validated.data.raw,
        },
      });
      summary.created++;
    } catch (error) {
      // Race between the findUnique check above and this create (e.g. two
      // imports of the same file running concurrently) — same outcome as a
      // pre-existing duplicate, not a real failure.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        summary.duplicates++;
      } else {
        throw error;
      }
    }
  }

  return summary;
}
