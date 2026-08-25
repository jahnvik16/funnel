import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { InlineActionForm } from "../_components/InlineActionForm";
import { archiveSocialAccount, unarchiveSocialAccount } from "./actions";
import { NewSocialAccountForm } from "./NewSocialAccountForm";

export default async function SocialAccountsPage() {
  const [accounts, brands, platforms] = await Promise.all([
    prisma.socialAccount.findMany({
      orderBy: { createdAt: "desc" },
      include: { brand: true, platform: true },
    }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Social accounts</h1>

      <NewSocialAccountForm brands={brands} platforms={platforms} />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Handle</th>
            <th className={ui.th}>Brand</th>
            <th className={ui.th}>Platform</th>
            <th className={ui.th}>Status</th>
            <th className={ui.th}></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td className={ui.td}>
                <Link href={`/admin/social-accounts/${account.id}`} className={ui.link}>
                  {account.handle}
                </Link>
              </td>
              <td className={ui.td}>{account.brand.name}</td>
              <td className={ui.td}>{account.platform.name}</td>
              <td className={ui.td}>
                <StatusBadge status={account.status} />
              </td>
              <td className={ui.td}>
                {account.status === "ACTIVE" ? (
                  <InlineActionForm
                    action={archiveSocialAccount}
                    id={account.id}
                    label="Archive"
                    variant="danger"
                  />
                ) : (
                  <InlineActionForm action={unarchiveSocialAccount} id={account.id} label="Unarchive" />
                )}
              </td>
            </tr>
          ))}
          {accounts.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={5}>
                <span className={ui.muted}>No social accounts yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
