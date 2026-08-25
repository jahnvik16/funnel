import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { InlineActionForm } from "../_components/InlineActionForm";
import { archiveTelegramBot, unarchiveTelegramBot } from "./actions";
import { TELEGRAM_BOT_SAFE_SELECT } from "./selects";
import { NewTelegramBotForm } from "./NewTelegramBotForm";

export default async function TelegramBotsPage() {
  const [bots, brands] = await Promise.all([
    prisma.telegramBot.findMany({
      orderBy: { createdAt: "desc" },
      select: { ...TELEGRAM_BOT_SAFE_SELECT, brand: { select: { name: true } } },
    }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Telegram bots</h1>

      <NewTelegramBotForm brands={brands} />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Name</th>
            <th className={ui.th}>Brand</th>
            <th className={ui.th}>Username</th>
            <th className={ui.th}>Token</th>
            <th className={ui.th}>Status</th>
            <th className={ui.th}></th>
          </tr>
        </thead>
        <tbody>
          {bots.map((bot) => (
            <tr key={bot.id}>
              <td className={ui.td}>
                <Link href={`/admin/telegram-bots/${bot.id}`} className={ui.link}>
                  {bot.name}
                </Link>
              </td>
              <td className={ui.td}>{bot.brand.name}</td>
              <td className={ui.td}>
                {bot.botUsername ? `@${bot.botUsername}` : <span className={ui.muted}>Not validated</span>}
              </td>
              <td className={ui.td}>
                <span className={`${ui.badge} ${ui.badgeActive}`}>Configured</span>
              </td>
              <td className={ui.td}>
                <StatusBadge status={bot.status} />
              </td>
              <td className={ui.td}>
                {bot.status === "ACTIVE" ? (
                  <InlineActionForm action={archiveTelegramBot} id={bot.id} label="Archive" variant="danger" />
                ) : (
                  <InlineActionForm action={unarchiveTelegramBot} id={bot.id} label="Unarchive" />
                )}
              </td>
            </tr>
          ))}
          {bots.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={6}>
                <span className={ui.muted}>No Telegram bots yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
