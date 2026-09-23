import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import { monadMainnet, monadTestnet } from "@deltamon/shared";
import { walletChains } from "@/lib/crosschain/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

export const wagmiConfig = getDefaultConfig({
  appName: "DeltaMon",
  appDescription: "Delta-neutral vaults on Monad",
  projectId: projectId || "",
  // A placeholder project ID makes Reown reject configuration requests with 403.
  // Browser-injected EVM wallets still work without WalletConnect credentials.
  wallets: projectId ? undefined : [{ groupName: "Available", wallets: [injectedWallet] }],
  chains: [...walletChains, monadTestnet],
  transports: Object.fromEntries([...walletChains, monadTestnet].map((chain) => [chain.id, http()])),
  ssr: true,
});

/** Mainnet by default: the vault lives there, and testnet Kuru has no liquidity to swap against. */
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? monadMainnet.id);
