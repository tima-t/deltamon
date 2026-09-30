import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { VaultDashboard } from "@/components/VaultDashboard";
import { HowItWorks } from "@/components/HowItWorks";
import { CharacterStory } from "@/components/CharacterStory";
import { Risks } from "@/components/Risks";
import { SHOW_TIPPET_LORE } from "@/lib/featureFlags";

export default function Home() {
  return (
    <main id="top" className="flex flex-1 flex-col">
      <SiteHeader />

      <VaultDashboard />
      {SHOW_TIPPET_LORE ? <CharacterStory /> : null}
      <HowItWorks />
      {/* <Risks /> */}
      <SiteFooter />
    </main>
  );
}
