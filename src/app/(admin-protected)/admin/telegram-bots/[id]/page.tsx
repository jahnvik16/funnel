import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { TELEGRAM_BOT_SAFE_SELECT } from "../selects";
import { EditTelegramBotForm } from "./EditTelegramBotForm";

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
      <h1 className={ui.pageTitle}>{bot.name}</h1>
      <EditTelegramBotForm bot={bot} brands={brands} />
    </div>
  );
}
