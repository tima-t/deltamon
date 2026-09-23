import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { VaultDashboard } from "@/components/VaultDashboard";
import { HowItWorks } from "@/components/HowItWorks";
import { Risks } from "@/components/Risks";

export default function Home() {
  return (
    <main id="top" className="flex flex-1 flex-col">
      <SiteHeader />

      <VaultDashboard />
      <HowItWorks />
      <Risks />
      <SiteFooter />
    </main>
  );
}
