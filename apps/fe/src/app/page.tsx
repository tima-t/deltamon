import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { VaultDashboard } from "@/components/VaultDashboard";
import { CharacterStory } from "@/components/CharacterStory";
import { SHOW_TIPPET_LORE } from "@/lib/featureFlags";
import styles from "./home.module.css";

export default function Home() {
  return (
    <main id="top" className={`${styles.publication} flex flex-1 flex-col`}>
      <SiteHeader />

      <VaultDashboard />
      {SHOW_TIPPET_LORE ? <CharacterStory /> : null}
      {/* <HowItWorks />
      <Risks /> */}
      <SiteFooter />
    </main>
  );
}
