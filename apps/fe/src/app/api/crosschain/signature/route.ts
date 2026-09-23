import { isHex } from "viem";
import { errorResponse, jsonBody } from "@/lib/crosschain/http";
import { DepositError, parseAccount, submitSignature } from "@/lib/crosschain/server";

export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    const account = parseAccount(body.account);
    if (typeof body.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(body.id)) {
      throw new DepositError("Invalid execution ID");
    }
    if (typeof body.signature !== "string" || !isHex(body.signature)) {
      throw new DepositError("Invalid wallet signature");
    }
    return Response.json(await submitSignature(account, body.id, body.signature));
  } catch (error) {
    return errorResponse(error);
  }
}
