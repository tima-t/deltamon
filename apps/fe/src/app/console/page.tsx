import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { VaultConsole } from "@/components/console/VaultConsole";

export const metadata = {
  title: "DeltaMon · vault console",
  description: "Drive a DeltaMonVault directly: deposit, redeem, allocate, mark the perp book.",
};

export default function ConsolePage() {
  return (
    <main className="flex flex-1 flex-col">
      <SiteHeader />
      <VaultConsole />
      <SiteFooter />
    </main>
  );
}
