"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, lightTheme, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";

const rkLight = lightTheme({ accentColor: "#836EF9", borderRadius: "medium" });
const rkDark = darkTheme({ accentColor: "#A594FF", borderRadius: "medium" });

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={{ lightMode: rkLight, darkMode: rkDark }} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
