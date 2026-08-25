import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadClickWithSnapshot, writeFunnelEvent } from "@/lib/public-routing";
import { acceptAgeGate, declineAgeGate } from "./actions";

export default async function AgeGatePage({
  params,
  searchParams,
}: {
  params: Promise<{ clickId: string }>;
  searchParams: Promise<{ declined?: string }>;
}) {
  const { clickId } = await params;
  const { declined } = await searchParams;

  const loaded = await loadClickWithSnapshot(prisma, clickId);
  if (!loaded) notFound();

  if (!declined) {
    await writeFunnelEvent(prisma, clickId, "AGE_GATE_SHOWN");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 p-8 text-center dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        {declined ? (
          <>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Content unavailable
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              You indicated you do not meet the age requirement to view this content.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Age verification
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              You must be 18 years of age or older to continue.
            </p>
            <div className="flex flex-col gap-2">
              <form action={acceptAgeGate}>
                <input type="hidden" name="clickId" value={clickId} />
                <button
                  type="submit"
                  className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                >
                  Yes, I am 18 or older
                </button>
              </form>
              <form action={declineAgeGate}>
                <input type="hidden" name="clickId" value={clickId} />
                <button
                  type="submit"
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                >
                  No
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
