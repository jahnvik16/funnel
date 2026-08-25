// Extracted from the route handler so it's directly unit-testable with a
// fake db object, without needing to actually stop the real Postgres
// container the way the pre-production QA pass did manually. Kept
// framework-independent (no next/headers, no NextResponse) for the same
// reason as lib/tracking-link-publishing.ts and friends.
export type QueryableDb = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};

export type DatabaseHealth = "connected" | "unreachable";

export async function checkDatabaseHealth(db: QueryableDb): Promise<DatabaseHealth> {
  try {
    await db.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "unreachable";
  }
}
