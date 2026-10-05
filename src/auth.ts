import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { PlatformRole } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { verifySecondFactor } from "@/lib/totp";
import { PLATFORM_ADMIN_EMAILS } from "@/lib/settings";

declare module "next-auth" {
  interface Session {
    user: { id: string; platformRole: PlatformRole } & DefaultSession["user"];
  }
}

class InvalidLogin extends CredentialsSignin {
  code = "invalid";
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  code: z.string().optional(),
});

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  // Credentials sign-in requires JWT sessions in Auth.js.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    ...(googleEnabled ? [Google] : []),
    Credentials({
      credentials: { email: {}, password: {}, code: {} },
      // The login server action already shows friendly errors; this re-checks
      // everything because it is the actual security boundary.
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidLogin();
        const { email, password, code } = parsed.data;
        const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw new InvalidLogin();
        if (!user.emailVerified || user.suspendedAt) throw new InvalidLogin();
        if (user.twoFactorEnabled && !(await verifySecondFactor(user, code ?? "", true))) throw new InvalidLogin();
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        if (!profile?.email_verified) return false;
        const existing = user.email ? await db.user.findUnique({ where: { email: user.email.toLowerCase() } }) : null;
        if (existing?.suspendedAt) return false;
        // Google sign-in skips our TOTP check, so accounts with 2FA on must use password + code.
        if (existing?.twoFactorEnabled) return "/login?error=2fa_password";
      }
      return true;
    },
    async jwt({ token, user }) {
      const id = (user?.id ?? token.sub) as string | undefined;
      if (id) {
        const row = await db.user.findUnique({ where: { id }, select: { platformRole: true, suspendedAt: true, name: true } });
        if (!row || row.suspendedAt) return null; // ends the session
        token.sub = id;
        token.platformRole = row.platformRole;
        token.name = row.name;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.platformRole = (token.platformRole as PlatformRole) ?? "USER";
      return session;
    },
  },
  events: {
    // Google accounts: mark email verified and promote configured admins.
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      await db.user.update({
        where: { id: user.id },
        data: {
          email: user.email.toLowerCase(),
          emailVerified: new Date(),
          platformRole: PLATFORM_ADMIN_EMAILS.includes(user.email.toLowerCase()) ? "ADMIN" : "USER",
        },
      });
    },
  },
});
