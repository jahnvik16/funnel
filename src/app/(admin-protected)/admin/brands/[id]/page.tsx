import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { EditBrandForm } from "./EditBrandForm";

export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/brands" className={ui.link}>
          ← Brands
        </Link>
      </div>
      <h1 className={ui.pageTitle}>{brand.name}</h1>
      <EditBrandForm brand={brand} />
    </div>
  );
}
