import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../../_components/StatusBadge";
import { TELEGRAM_BOT_SAFE_SELECT } from "../selects";
import { EditTelegramBotForm } from "./EditTelegramBotForm";
import { ValidateBotForm } from "./ValidateBotForm";

export default async function EditTelegramBotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bot, brands] = await Promise.all([
    prisma.telegramBot.findUnique({ where: { id }, select: TELEGRAM_BOT_SAFE_SELECT }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!bot) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/telegram-bots" className={ui.link}>
          ← Telegram bots
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <h1 className={ui.pageTitle}>{bot.name}</h1>
        <StatusBadge status={bot.status} />
      </div>
      <p className={ui.muted}>
        {bot.botUsername ? `@${bot.botUsername}` : "Not yet validated — no username on file."}
      </p>

      <section className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Validation</h2>
        <ValidateBotForm botId={bot.id} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Settings</h2>
        <EditTelegramBotForm bot={bot} brands={brands} />
      </section>
    </div>
  );
}
