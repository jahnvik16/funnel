import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { InlineActionForm } from "../_components/InlineActionForm";
import { archiveApiConnection, unarchiveApiConnection } from "./actions";
import { API_CONNECTION_SAFE_SELECT } from "./selects";
import { NewApiConnectionForm } from "./NewApiConnectionForm";

export default async function ApiConnectionsPage() {
  const [connections, brands] = await Promise.all([
    prisma.apiConnection.findMany({
      orderBy: { createdAt: "desc" },
      select: API_CONNECTION_SAFE_SELECT,
    }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>API connections</h1>

      <NewApiConnectionForm brands={brands} />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Name</th>
            <th className={ui.th}>Provider</th>
            <th className={ui.th}>Auth type</th>
            <th className={ui.th}>Credentials</th>
            <th className={ui.th}>Status</th>
            <th className={ui.th}></th>
          </tr>
        </thead>
        <tbody>
          {connections.map((connection) => (
            <tr key={connection.id}>
              <td className={ui.td}>
                <Link href={`/admin/api-connections/${connection.id}`} className={ui.link}>
                  {connection.name}
                </Link>
              </td>
              <td className={ui.td}>{connection.provider}</td>
              <td className={ui.td}>{connection.authType}</td>
              <td className={ui.td}>
                <span className={`${ui.badge} ${ui.badgeActive}`}>Configured</span>
              </td>
              <td className={ui.td}>
                <StatusBadge status={connection.status} />
              </td>
              <td className={ui.td}>
                {connection.status === "ACTIVE" ? (
                  <InlineActionForm
                    action={archiveApiConnection}
                    id={connection.id}
                    label="Archive"
                    variant="danger"
                  />
                ) : (
                  <InlineActionForm action={unarchiveApiConnection} id={connection.id} label="Unarchive" />
                )}
              </td>
            </tr>
          ))}
          {connections.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={6}>
                <span className={ui.muted}>No API connections yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
