import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { VaultDashboard } from "@/components/VaultDashboard";
import { HowItWorks } from "@/components/HowItWorks";
import { Risks } from "@/components/Risks";

export default function Home() {
  return (
    <main id="top" className="flex flex-1 flex-col">
      <SiteHeader />

      <section className="mx-auto w-full max-w-6xl px-5 pt-6 pb-10 sm:px-8 sm:pt-12">
        <h1 className="max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
          Deposit USDC. Hold MON without the busywork.
        </h1>
        <p className="text-muted mt-5 max-w-xl text-lg leading-relaxed">
          DeltaMon swaps 60% of every deposit into MON on Kuru and keeps the rest in USDC, all
          inside one vault contract. You get sdMON, a token for your share of the whole vault.
          Redeem for USDC or take the MON out any time.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a
            href="#deposit"
            className="bg-monad hover:bg-monad-deep rounded-lg px-5 py-3 font-medium text-white transition-colors"
          >
            Deposit USDC
          </a>
          <a
            href="#how"
            className="border-line hover:border-ink rounded-lg border px-5 py-3 font-medium transition-colors"
          >
            How a deposit works
          </a>
        </div>
      </section>

      <VaultDashboard />
      <HowItWorks />
      <Risks />
      <SiteFooter />
    </main>
  );
}
