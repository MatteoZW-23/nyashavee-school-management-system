import { auth } from "@/auth";
import { getDb } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { clientIp, rateLimit, rateLimited } from "@/lib/rate-limit";

// Rejects cross-site mutations (Origin mismatch) and throttles write traffic.
// Requests with no Origin header (curl, server-to-server) are allowed — browsers
// always send Origin on cross-site POSTs, so an absent header is not a bypass.
// X-Forwarded-Host is NOT trusted here: a cross-site browser fetch can set it,
// which would let Origin: attacker.com + X-Forwarded-Host: attacker.com pass.
// Behind a reverse proxy the canonical public host comes from the app URL.
export async function guardMutation(request: Request, routeName: string) {
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const allowed = new Set<string>();
    const host = request.headers.get("host");
    if (host) allowed.add(host);
    for (const env of [process.env.NEXT_PUBLIC_APP_URL, process.env.AUTH_URL]) {
      try {
        if (env) allowed.add(new URL(env).host);
      } catch { /* ignore malformed env */ }
    }
    if (!originHost || !allowed.has(originHost)) {
      throw Response.json({ error: "Cross-site request rejected." }, { status: 403 });
    }
  }
  const limit = await rateLimit(`mut:${clientIp(request)}:${routeName}`, 30, 60_000);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds, limit.unavailable);
}

export type SchoolContext = {
  userId: string;
  membershipId: string;
  tenantId: string;
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  currency: string;
  timezone: string;
  role: string;
  displayName: string;
  enabledModules: string[];
  exchangeRateZwgPerUsd: string | null;
};

function selectedSchoolId(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)school_workspace=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export async function getSchoolContext(request: Request): Promise<SchoolContext> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new Response("You are not signed in.", { status: 401 });
  }

  const schoolId = selectedSchoolId(request);
  const db = getDb();

  const membership = await db.schoolMembership.findFirst({
    where: {
      userId,
      active: true,
      user: { active: true },
      ...(schoolId ? { schoolId } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { school: { include: { tenant: true } } },
  });

  if (!membership) {
    throw new Response("You do not have access to a school workspace.", { status: 403 });
  }

  return {
    userId: membership.userId,
    membershipId: membership.id,
    tenantId: membership.school.tenantId,
    schoolId: membership.schoolId,
    schoolName: membership.school.name,
    schoolCode: membership.school.code,
    currency: membership.school.currency,
    timezone: membership.school.timezone,
    role: membership.role,
    displayName: membership.displayName,
    enabledModules: (() => { try { const v = JSON.parse(membership.school.enabledModules ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } })(),
    exchangeRateZwgPerUsd: membership.school.exchangeRateZwgPerUsd,
  };
}

export function requirePermission(context: SchoolContext, permission: string) {
  if (!hasPermission(context.role, permission)) {
    throw new Response("You are not permitted to perform this action.", { status: 403 });
  }
}
