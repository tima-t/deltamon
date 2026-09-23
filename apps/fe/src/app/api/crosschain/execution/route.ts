import { errorResponse, jsonBody } from "@/lib/crosschain/http";
import { parseInput, requestDepositExecution } from "@/lib/crosschain/server";

export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    const dry = body.mode === "quote";
    if (!dry && body.mode !== "create") {
      return Response.json({ error: "Invalid execution mode" }, { status: 400 });
    }
    const result = await requestDepositExecution(parseInput(body), dry);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
