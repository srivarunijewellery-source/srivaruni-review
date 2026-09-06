import type { Metadata } from "next";
import "./globals.css";
import Actions from "./actions";
import Link from "next/link";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Sri Varuni reel review", description: "Every reel measured against your own bar." };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let pending = 0;
  try { const { count } = await db().from("reels").select("id", { count: "exact", head: true }).eq("status", "pending"); pending = count ?? 0; } catch { /* login page before env is set */ }
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="top">
          <Link href="/" className="brand"><span className="mark">SV</span> Reel review</Link>
          <nav className="navlinks"><Link href="/">Reels</Link><Link href="/next">Next reel</Link><Link href="/experiments">Experiments</Link></nav>
          <nav><Actions pending={pending} /></nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
