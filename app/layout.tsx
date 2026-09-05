import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Sri Varuni reel review", description: "Every reel checked before it posts." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="top">
          <a href="/" className="brand">Sri Varuni <span>reel review</span></a>
          <nav>
            <form action="/api/scan" method="post"><button className="ghost" type="submit">Scan Drive now</button></form>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
