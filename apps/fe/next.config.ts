import type { NextConfig } from "next";

// RainbowKit → @wagmi/connectors (baseAccount) → @base-org/account (Node entry) → @coinbase/cdp-sdk,
// which references optional @x402/* packages that are not installed. Turbopack treats unresolved
// imports as build errors, so they are aliased to a stub. That code path is never executed here.
const optionalX402 = [
  "@x402/core/client",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/batch-settlement/client",
  "@x402/evm/exact/client",
  "@x402/evm/exact/server",
  "@x402/evm/exact/v1/client",
  "@x402/evm/upto/client",
  "@x402/evm/upto/server",
  "@x402/express",
  "@x402/extensions/bazaar",
  "@x402/extensions/builder-code",
  "@x402/fetch",
  "@x402/svm/exact/client",
  "@x402/svm/exact/server",
  "@x402/svm/exact/v1/client",
];

// @metamask/sdk imports React Native's async storage for its RN transport. It is guarded at runtime
// and never reached in a browser, but the import is static, so a web build still has to resolve it.
const optionalNative = ["@react-native-async-storage/async-storage"];

const unresolvable = [...optionalX402, ...optionalNative];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@deltamon/shared"],
  turbopack: {
    resolveAlias: Object.fromEntries(unresolvable.map((m) => [m, "./src/lib/x402-stub.ts"])),
  },
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(unresolvable.map((module) => [module, false])),
    };
    return config;
  },
};

export default nextConfig;
