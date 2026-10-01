"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, lightTheme, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";
import { useTheme } from "@/components/ThemeToggle";
import { WalletEntryProvider } from "@/components/WalletEntry";

const lightBase = lightTheme({
  accentColor: "#6942bb",
  accentColorForeground: "#fff9eb",
  borderRadius: "none",
});
const darkBase = darkTheme({
  accentColor: "#c3a6ff",
  accentColorForeground: "#261e2b",
  borderRadius: "none",
});

const rkLight = {
  ...lightBase,
  colors: {
    ...lightBase.colors,
    modalBackground: "#f5ecd7",
    modalText: "#27202b",
    modalTextSecondary: "#655c66",
    modalTextDim: "#655c66",
    modalBorder: "#27202b",
    generalBorder: "#b5a999",
    modalBackdrop: "rgba(20, 13, 23, 0.72)",
  },
  shadows: { ...lightBase.shadows, dialog: "8px 8px 0 #6942bb" },
  fonts: { body: "var(--font-plex-sans), sans-serif" },
  radii: { ...lightBase.radii, modal: "3px", modalMobile: "3px" },
};
const rkDark = {
  ...darkBase,
  colors: {
    ...darkBase.colors,
    modalBackground: "#261e2b",
    modalText: "#fff6e7",
    modalTextSecondary: "#c8bcca",
    modalTextDim: "#c8bcca",
    modalBorder: "#fff6e7",
    generalBorder: "#88758b",
    modalBackdrop: "rgba(13, 8, 17, 0.78)",
  },
  shadows: { ...darkBase.shadows, dialog: "8px 8px 0 #c3a6ff" },
  fonts: { body: "var(--font-plex-sans), sans-serif" },
  radii: { ...darkBase.radii, modal: "3px", modalMobile: "3px" },
};

export function Providers({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme === "light" ? rkLight : rkDark} modalSize="compact">
          <WalletEntryProvider>{children}</WalletEntryProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
