import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "./providers";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return configured && configured !== "" ? configured : "http://localhost:3000";
}

export const metadata: Metadata = {
  // ?? only catches undefined, and a deploy that sets the variable to an empty string is the
  // common case; new URL("") throws and takes the whole build down.
  metadataBase: new URL(siteUrl()),
  title: "DeltaMon",
  description:
    "Put MON to work with a vault that targets balanced MON exposure. Explore the live holdings, manager-reported hedge and deposit path on Monad.",
  icons: { icon: "/brand/deltamon-mark.svg" },
  openGraph: {
    title: "DeltaMon · The Balance Engine",
    description: "See every side of the vault.",
    images: ["/art/balance-engine-social.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
