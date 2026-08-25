import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { API_CONNECTION_SAFE_SELECT } from "../selects";
import { EditApiConnectionForm } from "./EditApiConnectionForm";

export default async function EditApiConnectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [connection, brands] = await Promise.all([
    prisma.apiConnection.findUnique({ where: { id }, select: API_CONNECTION_SAFE_SELECT }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!connection) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/api-connections" className={ui.link}>
          ← API connections
        </Link>
      </div>
      <h1 className={ui.pageTitle}>{connection.name}</h1>
      <EditApiConnectionForm connection={connection} brands={brands} />
    </div>
  );
}
