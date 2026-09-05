import { NextRequest, NextResponse } from "next/server";
import { COOKIE, tokenFor, validPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const pw = String(form.get("password") ?? "");
  if (!validPassword(pw)) return NextResponse.redirect(new URL("/login?bad=1", req.url), 303);
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(COOKIE, tokenFor(pw), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 90 });
  return res;
}
