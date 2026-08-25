"use server";

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import { importPaybigCsv, type ImportSummary } from "@/lib/paybig-import";
import { logger } from "@/lib/logger";
import { getOrCreateRequestId } from "@/lib/request-context";

export type ImportFormState = { error?: string; summary?: ImportSummary };

// A generous cap for a CSV of conversion rows — well beyond any real Paybig
// export seen so far. Without a limit, importPaybigCsv's row-by-row DB writes
// on an arbitrarily large upload could tie up the request (and the database)
// for an unbounded amount of time; rejecting upfront fails fast instead.
const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

export async function importConversionsCsv(
  _prevState: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const admin = await requireAdmin();

  const file = formData.get("csvFile");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return { error: `File is too large (${Math.round(file.size / 1024 / 1024)} MB) — the limit is 10 MB.` };
  }

  const requestId = getOrCreateRequestId(await headers());
  const content = await file.text();
  const summary = await importPaybigCsv(prisma, content);

  // One audit row per import batch, not per Conversion row — the row-level
  // detail (invalid/unmatched reasons) lives in the returned summary itself.
  const entityId = randomUUID();
  await writeAuditLog(prisma, {
    actorId: admin.id,
    action: "IMPORT",
    entityType: "ConversionImport",
    entityId,
    after: summary,
  });

  // Structured log line with the same counts, so the summary is visible in
  // server logs/log-based alerting without opening the admin UI.
  logger.info("paybig_import_completed", {
    requestId,
    importId: entityId,
    adminUserId: admin.id,
    totalRows: summary.totalRows,
    created: summary.created,
    duplicates: summary.duplicates,
    statusUpdated: summary.statusUpdated,
    matchedCampaigns: summary.matchedCampaigns,
    invalidCount: summary.invalid.length,
    unmatchedCount: summary.unmatched.length,
  });

  revalidatePath("/admin/conversions");

  return { summary };
}
