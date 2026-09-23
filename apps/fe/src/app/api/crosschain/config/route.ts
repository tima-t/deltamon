export async function GET() {
  return Response.json({
    enabled:
      Boolean(process.env.AURORA_INTENTS_API_KEY) &&
      process.env.AURORA_CROSSCHAIN_ENABLED === "true",
  });
}
