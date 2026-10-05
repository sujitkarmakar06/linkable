import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentMembership, requireUser } from "@/server/session";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  await requireUser();
  if (!(await getCurrentMembership())) redirect("/onboarding");
  return <AppShell>{children}</AppShell>;
}
