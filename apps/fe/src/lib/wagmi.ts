import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { monadMainnet, monadTestnet } from "@deltamon/shared";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "deltamon-local-dev";

export const wagmiConfig = getDefaultConfig({
  appName: "DeltaMon",
  appDescription: "Delta-neutral vaults on Monad",
  projectId,
  chains: [monadMainnet, monadTestnet],
  transports: {
    [monadMainnet.id]: http(),
    [monadTestnet.id]: http(),
  },
  ssr: true,
});

/** Mainnet by default: the vault lives there, and testnet Kuru has no liquidity to swap against. */
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? monadMainnet.id);
