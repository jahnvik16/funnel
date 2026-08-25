import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { EditDomainForm } from "./EditDomainForm";

export default async function EditDomainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [domain, brands] = await Promise.all([
    prisma.domain.findUnique({ where: { id } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!domain) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/domains" className={ui.link}>
          ← Domains
        </Link>
      </div>
      <h1 className={ui.pageTitle}>{domain.hostname}</h1>
      <EditDomainForm domain={domain} brands={brands} />
    </div>
  );
}
