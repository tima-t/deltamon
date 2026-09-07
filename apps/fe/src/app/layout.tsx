import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "./providers";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DeltaMon",
  description:
    "Deposit USDC, hold 60% MON and 40% USDC in one vault on Monad, and receive sdMON for your share. Built for Monad Metropolis.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
