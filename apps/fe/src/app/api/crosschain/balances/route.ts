import { isAddress } from "viem";
import { getFundedAssets } from "@/lib/crosschain/catalog";
import { errorResponse } from "@/lib/crosschain/http";

export async function GET(request: Request) {
  try {
    const address = new URL(request.url).searchParams.get("address");
    if (!address || !isAddress(address)) {
      return Response.json({ error: "Connect an EVM wallet first" }, { status: 400 });
    }
    return Response.json({ assets: await getFundedAssets(address) });
  } catch (error) {
    return errorResponse(error);
  }
}
