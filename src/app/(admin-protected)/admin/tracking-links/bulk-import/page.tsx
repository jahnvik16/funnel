import Link from "next/link";
import { ui } from "@/lib/ui";
import { BulkImportForm } from "./BulkImportForm";

export default function BulkImportTrackingLinksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className={ui.pageTitle}>Bulk import tracking links</h1>
        <Link href="/admin/tracking-links" className={ui.link}>
          Back to tracking links
        </Link>
      </div>
      <BulkImportForm />
    </div>
  );
}
