import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { InlineActionForm } from "../_components/InlineActionForm";
import { archiveBrand, unarchiveBrand } from "./actions";
import { NewBrandForm } from "./NewBrandForm";

export default async function BrandsPage() {
  const brands = await prisma.brand.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Brands</h1>

      <NewBrandForm />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Name</th>
            <th className={ui.th}>Slug</th>
            <th className={ui.th}>Status</th>
            <th className={ui.th}></th>
          </tr>
        </thead>
        <tbody>
          {brands.map((brand) => (
            <tr key={brand.id}>
              <td className={ui.td}>
                <Link href={`/admin/brands/${brand.id}`} className={ui.link}>
                  {brand.name}
                </Link>
              </td>
              <td className={ui.td}>{brand.slug}</td>
              <td className={ui.td}>
                <StatusBadge status={brand.status} />
              </td>
              <td className={ui.td}>
                {brand.status === "ACTIVE" ? (
                  <InlineActionForm action={archiveBrand} id={brand.id} label="Archive" variant="danger" />
                ) : (
                  <InlineActionForm action={unarchiveBrand} id={brand.id} label="Unarchive" />
                )}
              </td>
            </tr>
          ))}
          {brands.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={4}>
                <span className={ui.muted}>No brands yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
