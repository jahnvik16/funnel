"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import { importPaybigCsv, type ImportSummary } from "@/lib/paybig-import";

export type ImportFormState = { error?: string; summary?: ImportSummary };

export async function importConversionsCsv(
  _prevState: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const admin = await requireAdmin();

  const file = formData.get("csvFile");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }

  const content = await file.text();
  const summary = await importPaybigCsv(prisma, content);

  // One audit row per import batch, not per Conversion row — the row-level
  // detail (invalid/unmatched reasons) lives in the returned summary itself.
  await writeAuditLog(prisma, {
    actorId: admin.id,
    action: "IMPORT",
    entityType: "ConversionImport",
    entityId: randomUUID(),
    after: summary,
  });

  revalidatePath("/admin/conversions");

  return { summary };
}
