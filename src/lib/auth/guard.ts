import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/auth/session";

export type CurrentAdmin = {
  id: string;
  email: string;
  role: string;
};

// Returns only non-sensitive fields, even though the underlying record isn't
// secret — callers routinely forward this to Server Components close to the
// client boundary, so it should never carry passwordHash by accident.
export async function requireAdmin(): Promise<CurrentAdmin> {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) {
    redirect("/admin/login");
  }
  return { id: adminUser.id, email: adminUser.email, role: adminUser.role };
}
