import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/server/session";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return <AppShell>{children}</AppShell>;
}
