import type { Prisma } from "@prisma/client";

export type AuditAction = "CREATE" | "UPDATE" | "ARCHIVE" | "UNARCHIVE" | "PUBLISH";

type WriteAuditLogParams = {
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

// Every admin mutation must call this inside the same transaction as the
// mutation itself (CLAUDE.md rule 10) — never as a fire-and-forget side
// effect, so a failed audit write rolls back the mutation too.
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  { actorId, action, entityType, entityId, before, after }: WriteAuditLogParams,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      beforeJson: before === undefined ? undefined : (before as Prisma.InputJsonValue),
      afterJson: after === undefined ? undefined : (after as Prisma.InputJsonValue),
    },
  });
}

// Strips fields that must never be persisted in an audit trail — ciphertext
// secrets don't belong there even encrypted, per CLAUDE.md rule 11/12; keeping
// them out of AuditLog avoids one more place they could ever leak from.
export function redactSecretFields<T extends Record<string, unknown>>(
  entity: T,
  fields: (keyof T)[],
): T {
  const copy = { ...entity };
  for (const field of fields) {
    if (field in copy) {
      copy[field] = "[REDACTED]" as T[keyof T];
    }
  }
  return copy;
}
