import { isAddress, isHash } from "viem";
import { errorResponse, jsonBody } from "@/lib/crosschain/http";
import { auroraRequest, DepositError } from "@/lib/crosschain/server";

export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    if (typeof body.depositAddress !== "string" || !isAddress(body.depositAddress)) {
      throw new DepositError("Invalid Aurora deposit address");
    }
    if (typeof body.txHash !== "string" || !isHash(body.txHash)) {
      throw new DepositError("Invalid source transaction hash");
    }
    return Response.json(
      await auroraRequest("/executions/deposit/submit", {
        method: "POST",
        body: JSON.stringify({ depositAddress: body.depositAddress, txHash: body.txHash }),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
