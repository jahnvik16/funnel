import { prisma } from "@/lib/prisma";

export default async function AdminDashboardPage() {
  const [brands, platforms, trackingLinks, clicks] = await Promise.all([
    prisma.brand.count(),
    prisma.platform.count(),
    prisma.trackingLink.count(),
    prisma.click.count(),
  ]);

  const stats = [
    { label: "Brands", value: brands },
    { label: "Platforms", value: platforms },
    { label: "Tracking links", value: trackingLinks },
    { label: "Clicks", value: clicks },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Foundation milestone — entity CRUD isn&apos;t built yet. These counts confirm the
        admin app is authenticated and reading live from the database.
      </p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <dt className="text-xs uppercase tracking-wide text-zinc-500">{stat.label}</dt>
            <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
