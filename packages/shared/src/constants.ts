export const BPS = 10_000;

/** Target net APY the product is designed around (basis points). */
export const TARGET_APY_BPS = 1_500;

/** v1 sdMON vault: share of every deposit swapped into MON on Kuru. */
export const TARGET_MON_BPS = 6_000;

/** v1: rebalance when |monShare − target| exceeds this many bps. */
export const DEFAULT_REBALANCE_THRESHOLD_BPS = 500;

/** Kuru MON/USDC market minimum order size (MON). */
export const KURU_MIN_ORDER_MON = 200;

/** Share of each deployment sent to the hedge venue as collateral. */
export const DEFAULT_HEDGE_COLLATERAL_BPS = 5_000;

/** Kept idle in the strategy so small withdrawals need no unwind. */
export const DEFAULT_LIQUIDITY_BUFFER_BPS = 500;

export const PERPL_FUNDING_INTERVAL_BLOCKS = 8_571; // ≈ 1 hour at 0.42s blocks
export const PERPL_API_URL = "https://app.perpl.xyz/api";
export const PERPL_TESTNET_API_URL = "https://testnet.perpl.xyz/api";
export const PYTH_HERMES_URL = "https://hermes.pyth.network";

export const HACKATHON = {
  name: "Monad Metropolis",
  url: "https://hackathon.monad.xyz/",
  track: "Onchain Finance & Trading",
  submissionDeadline: "2026-10-13",
} as const;
