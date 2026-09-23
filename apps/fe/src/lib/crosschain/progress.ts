export type DepositStageState = "complete" | "active" | "waiting" | "failed";

export interface DepositStage {
  title: string;
  detail: string;
  state: DepositStageState;
}

export function getDepositStages(
  status: string | undefined,
  sourceName: string,
  sourceTxSent: boolean,
  mintConfirmed: boolean,
): DepositStage[] {
  const fundingFailed = status === "DEPOSIT_FAILED" || status === "EXPIRED";
  const vaultFailed = status === "OPERATION_FAILED";
  const routingStarted = ["DEPOSIT_PROCESSING", "OPERATION_PENDING", "OPERATION_PROCESSING", "SUCCESS", "OPERATION_FAILED"].includes(status ?? "");
  const routingComplete = ["OPERATION_PENDING", "OPERATION_PROCESSING", "SUCCESS", "OPERATION_FAILED"].includes(status ?? "");
  const vaultStarted = ["OPERATION_PENDING", "OPERATION_PROCESSING", "SUCCESS", "OPERATION_FAILED"].includes(status ?? "");
  const vaultComplete = status === "SUCCESS";

  return [
    {
      title: `Send USDC from ${sourceName}`,
      detail: fundingFailed
        ? "The transfer failed or expired. Check its refund before trying again."
        : routingStarted ? "Source transfer confirmed." : sourceTxSent
          ? "Transfer sent. Waiting for source-chain confirmation."
          : "Confirm the transfer in your wallet to begin.",
      state: fundingFailed ? "failed" : routingStarted ? "complete" : "active",
    },
    {
      title: "Move USDC to Monad",
      detail: routingComplete ? "USDC arrived on Monad." : routingStarted
        ? "Aurora is routing your USDC to Monad."
        : "Starts after the source transfer is confirmed.",
      state: routingComplete ? "complete" : routingStarted ? "active" : "waiting",
    },
    {
      title: "Deposit into the vault",
      detail: vaultFailed ? "The vault call failed. Check the intermediary balance below."
        : vaultComplete ? "Vault transaction completed." : vaultStarted
          ? "Waiting for the vault transaction on Monad."
          : "The vault receives USDC after routing.",
      state: vaultFailed ? "failed" : vaultComplete ? "complete" : vaultStarted ? "active" : "waiting",
    },
    {
      title: "Receive sdMON",
      detail: mintConfirmed ? "Shares confirmed in your connected wallet." : vaultComplete
        ? "Checking the vault event and your sdMON balance."
        : "Shares go to the same wallet address on Monad.",
      state: mintConfirmed ? "complete" : vaultComplete ? "active" : "waiting",
    },
  ];
}
