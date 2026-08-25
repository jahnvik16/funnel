import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { EditSocialAccountForm } from "./EditSocialAccountForm";

export default async function EditSocialAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [account, brands, platforms] = await Promise.all([
    prisma.socialAccount.findUnique({ where: { id } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!account) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/social-accounts" className={ui.link}>
          ← Social accounts
        </Link>
      </div>
      <h1 className={ui.pageTitle}>{account.handle}</h1>
      <EditSocialAccountForm account={account} brands={brands} platforms={platforms} />
    </div>
  );
}
