import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadClickWithSnapshot, handlePathView } from "@/lib/public-routing";

export default async function PathPage({ params }: { params: Promise<{ clickId: string }> }) {
  const { clickId } = await params;

  const loaded = await loadClickWithSnapshot(prisma, clickId);
  if (!loaded) notFound();

  const result = await handlePathView(prisma, clickId, loaded.snapshot);

  if (result.ok && result.render === "redirect_direct") {
    redirect(`/out/${clickId}`);
  }

  if (result.ok && result.render === "redirect_telegram") {
    redirect(result.deepLinkUrl);
  }

  if (!result.ok) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 p-8 text-center dark:bg-black">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          This link isn&apos;t available right now
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Please try again later.</p>
      </div>
    );
  }

  const { snapshot } = loaded;

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 p-8 text-center dark:bg-black">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {snapshot.brand.name}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {snapshot.campaign.name} — continue to view this offer.
        </p>
        <a
          href={`/out/${clickId}`}
          className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Continue
        </a>
      </div>
    </div>
  );
}
