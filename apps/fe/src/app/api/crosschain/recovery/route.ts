import { erc20Abi } from "@deltamon/shared";
import { errorResponse, jsonBody } from "@/lib/crosschain/http";
import { getCrossChainCatalog } from "@/lib/crosschain/catalog";
import {
  auroraRequest,
  DepositError,
  fetchExecution,
  getIntermediary,
  monadClient,
  parseAccount,
  usdcAddress,
} from "@/lib/crosschain/server";

interface StepsResponse {
  result: {
    id?: string;
    details?: { networkFee?: string; payload?: { payload_json?: string; standard?: string } };
    status?: string;
  };
}

export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    const account = parseAccount(body.account);
    if (typeof body.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(body.id)) {
      throw new DepositError("Invalid deposit execution ID");
    }
    if (body.mode !== "quote" && body.mode !== "create") {
      throw new DepositError("Invalid recovery mode");
    }
    const original = (await fetchExecution(account, body.id)).result;
    if (!["SUCCESS", "OPERATION_FAILED"].includes(original.status ?? "")) {
      throw new DepositError("Recovery is available only after the deposit has settled or failed on Monad");
    }
    const intermediary = await getIntermediary(account);
    const balance = await monadClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [intermediary],
    });
    if (balance === 0n) throw new DepositError("No USDC remains in the intermediary account");
    const { destinationAssetId } = await getCrossChainCatalog();
    const requestSteps = (amount: bigint, dry: boolean) =>
      auroraRequest<StepsResponse>(`/executions/${account}/steps`, {
        method: "POST",
        body: JSON.stringify({
          version: "1.0",
          type: "evm",
          dry,
          destinationAsset: destinationAssetId,
          metadata: { title: "Recover DeltaMon USDC", intent: "deltamon_recovery" },
          steps: [{
            to: usdcAddress,
            functionSignature: "transfer(address,uint256)",
            parameters: [account, amount.toString()],
            value: "0",
          }],
        }),
      });
    const estimate = await requestSteps(1n, true);
    const feeText = estimate.result.details?.networkFee;
    if (!feeText || !/^\d+$/.test(feeText)) throw new DepositError("Aurora did not estimate a recovery fee", 502);
    const fee = BigInt(feeText);
    if (balance <= fee * 2n + 1n) throw new DepositError("Remaining USDC is below the recovery fee");
    const amount = balance - fee * 2n;
    if (typeof body.minAcceptedAmount === "string" && /^\d+$/.test(body.minAcceptedAmount) && amount < BigInt(body.minAcceptedAmount)) {
      throw new DepositError("The recoverable amount changed. Review the new recovery quote");
    }
    const execution = await requestSteps(amount, body.mode === "quote");
    const finalFee = execution.result.details?.networkFee;
    if (!finalFee || !/^\d+$/.test(finalFee) || balance < amount + BigInt(finalFee)) {
      throw new DepositError("The intermediary balance cannot cover this recovery and its fee");
    }
    if (body.mode === "create" && !execution.result.id) {
      throw new DepositError("Aurora did not create a recovery execution", 502);
    }
    return Response.json({ execution: execution.result, amount: amount.toString(), fee: fee.toString() });
  } catch (error) {
    return errorResponse(error);
  }
}
