import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "@/db";
import bcrypt from "bcryptjs";

const db = getDb();

if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET is required in production.");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.passwordHash || !user.active) return null;

        const valid = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!valid) {
          // Record the failed attempt for audit when the account exists.
          const membership = await db.schoolMembership.findFirst({
            where: { userId: user.id, active: true },
            select: { schoolId: true },
          });
          if (membership) {
            await db.auditLog.create({
              data: {
                schoolId: membership.schoolId,
                actorMembershipId: null,
                action: "auth.login_failed",
                entityType: "user",
                entityId: user.id,
                details: JSON.stringify({ email: user.email }),
              },
            });
          }
          return null;
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  // School-day sessions: 12 hours, JWT. passwordChangedAt below invalidates
  // older tokens on the next request, so resets take effect immediately.
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      // Kill sessions issued before the last password change, and drop
      // sessions for deactivated accounts on their next request.
      if (token.id) {
        const current = await db.user.findUnique({
          where: { id: token.id as string },
          select: { active: true, passwordChangedAt: true },
        });
        // Compare at second granularity: a token issued in the same second as a
        // password change is newer, not older — without this, activate-then-sign-in
        // inside one second revokes the fresh session immediately. iat is absent
        // while the token is being minted at sign-in — treat that as "now",
        // never "the epoch", or every account with a passwordChangedAt would be
        // revoked on its first request.
        const tokenIssuedSeconds = typeof token.iat === "number" ? token.iat : Math.floor(Date.now() / 1000);
        const passwordChangedSeconds = current?.passwordChangedAt ? Math.floor(current.passwordChangedAt.getTime() / 1000) : 0;
        if (!current?.active || passwordChangedSeconds > tokenIssuedSeconds) {
          return {} as typeof token; // revoked — no id reaches the session
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
