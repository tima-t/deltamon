import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { VaultConsole } from "@/components/console/VaultConsole";
import publication from "../home.module.css";
import styles from "./console.module.css";

export const metadata = {
  title: "DeltaMon · vault console",
  description: "Drive a DeltaMonVault directly: deposit, redeem, allocate, mark the perp book.",
};

export default function ConsolePage() {
  return (
    <main className={`${publication.publication} ${styles.paper} flex flex-1 flex-col`}>
      <SiteHeader />
      <VaultConsole />
      <SiteFooter />
    </main>
  );
}
