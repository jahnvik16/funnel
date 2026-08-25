import { defineConfig } from "prisma/config";

// A prisma.config.ts file present in the project disables Prisma's automatic
// .env loading (unlike the legacy package.json#prisma config), so load it
// explicitly — DATABASE_URL below and the seed script both need it.
try {
  process.loadEnvFile();
} catch {
  // No .env file present (e.g. in CI where vars are injected directly) — fine.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
