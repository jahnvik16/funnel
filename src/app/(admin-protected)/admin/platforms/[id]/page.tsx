import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { EditPlatformForm } from "./EditPlatformForm";

export default async function EditPlatformPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const platform = await prisma.platform.findUnique({ where: { id } });
  if (!platform) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/platforms" className={ui.link}>
          ← Platforms
        </Link>
      </div>
      <h1 className={ui.pageTitle}>{platform.name}</h1>
      <EditPlatformForm platform={platform} />
    </div>
  );
}
