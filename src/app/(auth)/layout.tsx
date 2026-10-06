import { LegalLinks } from "@/components/legal";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">{children}</div>
      <div className="mt-6 text-xs text-muted">
        <LegalLinks />
      </div>
    </main>
  );
}
