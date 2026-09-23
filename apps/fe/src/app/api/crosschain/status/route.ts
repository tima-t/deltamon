import { isAddress, parseAbiItem } from "viem";
import { deltaMonVaultAbi, erc20Abi } from "@deltamon/shared";
import { errorResponse } from "@/lib/crosschain/http";
import {
  DepositError,
  fetchExecution,
  getIntermediary,
  monadClient,
  usdcAddress,
  vaultAddress,
} from "@/lib/crosschain/server";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const account = query.get("account");
    const id = query.get("id");
    if (!account || !isAddress(account) || !id || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
      throw new DepositError("Invalid execution lookup");
    }
    const execution = (await fetchExecution(account, id)).result;
    let intermediaryBalance: string | null = null;
    let shares: string | null = null;
    let mintTxHash: string | null = null;
    if (["SUCCESS", "OPERATION_FAILED"].includes(execution.status ?? "")) {
      const intermediary = await getIntermediary(account);
      const [balance, shareBalance] = await Promise.all([
        monadClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [intermediary],
        }),
        vaultAddress
          ? monadClient.readContract({
              address: vaultAddress,
              abi: deltaMonVaultAbi,
              functionName: "balanceOf",
              args: [account],
            })
          : Promise.resolve(null),
      ]);
      intermediaryBalance = balance.toString();
      shares = shareBalance?.toString() ?? null;
      const startBlock = query.get("startBlock");
      if (
        execution.status === "SUCCESS" &&
        vaultAddress &&
        startBlock &&
        /^\d+$/.test(startBlock)
      ) {
        const latest = await monadClient.getBlockNumber();
        const fromBlock = BigInt(startBlock);
        if (fromBlock <= latest && latest - fromBlock <= 50_000n) {
          try {
            const logs = await monadClient.getLogs({
              address: vaultAddress,
              event: parseAbiItem("event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)"),
              args: { sender: intermediary, owner: account },
              fromBlock,
              toBlock: latest,
            });
            mintTxHash = logs.at(-1)?.transactionHash ?? null;
          } catch {
            // Some public RPCs limit log ranges; the client can confirm a share-balance increase.
          }
        }
      }
    }
    return Response.json({ execution, intermediaryBalance, shares, mintTxHash });
  } catch (error) {
    return errorResponse(error);
  }
}
