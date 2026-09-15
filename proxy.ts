import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isResetPage = req.nextUrl.pathname === "/forgot-password" || req.nextUrl.pathname === "/reset-password" || req.nextUrl.pathname === "/verify";
  const isApiAuth = req.nextUrl.pathname.startsWith("/api/auth");
  // Public API endpoints: health probe, report-code verification, and the
  // Paynow webhook — that route authenticates itself via the payload hash and
  // must be reachable from the gateway without a session.
  const isSetup = req.nextUrl.pathname === "/setup" || req.nextUrl.pathname === "/api/setup";
  const isPublic = req.nextUrl.pathname.startsWith("/api/health") || req.nextUrl.pathname.startsWith("/api/verify") || req.nextUrl.pathname === "/api/paynow/webhook" || isSetup;

  if (isApiAuth || isPublic) {
    return NextResponse.next();
  }

  if (!isLoggedIn && !isLoginPage && !isResetPage) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
