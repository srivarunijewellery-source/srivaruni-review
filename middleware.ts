import { NextRequest, NextResponse } from "next/server";

// Edge runtime: sha256 via webcrypto, same formula as lib/auth.tokenFor.
async function tokenFor(pw: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("srivaruni:" + pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) return NextResponse.next();
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  const cookie = req.cookies.get("sv_auth")?.value;
  const header = req.headers.get("x-app-password");
  if (header === pw || cookie === (await tokenFor(pw))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
