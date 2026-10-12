import type { DepositStage } from "@/lib/crosschain/progress";

export function confirmedPressSteps(stages: DepositStage[]) {
  const pending = stages.findIndex((stage) => stage.state !== "complete");
  return pending < 0 ? stages.length : pending;
}

export function getMonadPressStages({
  action,
  signed,
  receiptStatus,
  allowanceSufficient,
  failed,
  submittedAmount,
}: {
  action: "approve" | "deposit" | null;
  signed: boolean;
  receiptStatus?: "success" | "reverted";
  allowanceSufficient: boolean;
  failed: boolean;
  submittedAmount: string;
}): DepositStage[] {
  const deposited = receiptStatus === "success" && action === "deposit";
  const approved =
    deposited || allowanceSufficient || (receiptStatus === "success" && action === "approve");
  return [
    {
      title: "Wallet authorization",
      detail: signed ? "Wallet request signed." : "Confirm the request in your wallet.",
      state: signed ? "complete" : failed ? "failed" : "active",
    },
    {
      title: "USDC allowance",
      detail: approved
        ? "The vault has permission to use this amount."
        : "Approval is separate from the deposit.",
      state: approved
        ? "complete"
        : signed && action === "approve"
          ? failed
            ? "failed"
            : "active"
          : "waiting",
    },
    {
      title: "Deposit into the vault",
      detail: deposited
        ? `${submittedAmount} USDC deposited on Monad.`
        : "Waiting for the vault transaction on Monad.",
      state: deposited
        ? "complete"
        : signed && action === "deposit"
          ? failed
            ? "failed"
            : "active"
          : "waiting",
    },
    {
      title: "Receive sdMON",
      detail: deposited
        ? "Shares confirmed in your connected wallet."
        : "Shares are issued by the successful vault deposit.",
      state: deposited ? "complete" : "waiting",
    },
  ];
}
