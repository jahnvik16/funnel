import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { InlineActionForm } from "../_components/InlineActionForm";
import { archiveDomain, unarchiveDomain } from "./actions";
import { NewDomainForm } from "./NewDomainForm";

export default async function DomainsPage() {
  const [domains, brands] = await Promise.all([
    prisma.domain.findMany({ orderBy: { createdAt: "desc" }, include: { brand: true } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Domains</h1>

      <NewDomainForm brands={brands} />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Hostname</th>
            <th className={ui.th}>Brand</th>
            <th className={ui.th}>Status</th>
            <th className={ui.th}></th>
          </tr>
        </thead>
        <tbody>
          {domains.map((domain) => (
            <tr key={domain.id}>
              <td className={ui.td}>
                <Link href={`/admin/domains/${domain.id}`} className={ui.link}>
                  {domain.hostname}
                </Link>
              </td>
              <td className={ui.td}>{domain.brand ? domain.brand.name : <span className={ui.muted}>Shared</span>}</td>
              <td className={ui.td}>
                <span
                  className={`${ui.badge} ${domain.isActive ? ui.badgeActive : ui.badgeArchived}`}
                >
                  {domain.isActive ? "ACTIVE" : "INACTIVE"}
                </span>
              </td>
              <td className={ui.td}>
                {domain.isActive ? (
                  <InlineActionForm action={archiveDomain} id={domain.id} label="Deactivate" variant="danger" />
                ) : (
                  <InlineActionForm action={unarchiveDomain} id={domain.id} label="Activate" />
                )}
              </td>
            </tr>
          ))}
          {domains.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={4}>
                <span className={ui.muted}>No domains yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
