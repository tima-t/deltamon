import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "./providers";
import { SHOW_TIPPET_LORE } from "@/lib/featureFlags";

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
    "Deposit USDC into a MON staking strategy and receive sdMON vault shares. See the MON position, latest reported short, and available exit liquidity on Monad.",
  icons: { icon: "/brand/deltamon-mark.svg" },
  openGraph: {
    title: "DeltaMon · MON staking, short reported",
    description: SHOW_TIPPET_LORE
      ? "Meet Tippet and inspect the MON holdings, latest short report, and exit liquidity."
      : "Inspect MON holdings, the latest short report, and available exit liquidity.",
    images: ["/art/balance-engine-social.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
