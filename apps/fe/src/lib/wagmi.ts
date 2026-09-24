import { connectorsForWallets, getDefaultWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { monadMainnet, monadTestnet } from "@deltamon/shared";
import { walletChains } from "@/lib/crosschain/chains";
import { meraConnector } from "@/lib/meraConnector";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

const appName = "DeltaMon";
const chains = [...walletChains, monadTestnet] as const;
const wallets = projectId
  ? getDefaultWallets({ appName, projectId }).wallets
  : [{ groupName: "Available", wallets: [injectedWallet] }];

export const wagmiConfig = createConfig({
  // RainbowKit only lists external wallets; the entry dialog owns passkey onboarding.
  connectors: [
    ...connectorsForWallets(wallets, { appName, projectId: projectId || "" }),
    meraConnector,
  ],
  chains,
  transports: Object.fromEntries(chains.map((chain) => [chain.id, http()])) as Record<(typeof chains)[number]["id"], ReturnType<typeof http>>,
  ssr: true,
});

/** Mainnet by default: the vault lives there, and testnet Kuru has no liquidity to swap against. */
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? monadMainnet.id);
