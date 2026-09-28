import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import {
  newNonce,
  restCanonical,
  sha256Hex,
  signCanonical,
  signinFrame,
  signingTarget,
  wsSigninCanonical,
} from "../src/services/perplAuth.js";
import {
  DEFAULT_LEVERAGE,
  FLAG_GTC,
  ORDER_TYPE,
  TRIGGER,
  closeShortFrame,
  marginUtilization,
  openShortFrames,
  scale,
  unscale,
  type MarketConfig,
} from "../src/services/perplOrders.js";

// MON as Perpl lists it today: market 10, prices to six decimals, whole-unit sizes.
const MON: MarketConfig = {
  id: 10,
  name: "MON",
  priceDecimals: 6,
  sizeDecimals: 0,
  orderTtlBlocks: 20,
  isOpen: true,
};

const SECRET = `0x${Buffer.from(ed.utils.randomSecretKey()).toString("hex")}`;

describe("perpl signing", () => {
  it("builds the six line REST canonical string in order", () => {
    expect(restCanonical(143, "get", "/api/v1/trading/fills?limit=1", "1790000000000", "n0", "ab")) //
      .toBe("143\nGET\n/api/v1/trading/fills?limit=1\n1790000000000\nn0\nab");
  });

  it("separates a socket sign in from any REST target", () => {
    expect(wsSigninCanonical(143, "1790000000000", "n0")).toBe(
      "143\ntrading-ws-signin\n1790000000000\nn0",
    );
  });

  it("hashes an empty body to the well known sha256 of nothing", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("signs so the public half verifies, and encodes base64url without padding", async () => {
    const canonical = wsSigninCanonical(143, "1790000000000", "nonce");
    const signature = await signCanonical(SECRET, canonical);
    expect(signature).not.toMatch(/[+/=]/);
    const ok = await ed.verifyAsync(
      Buffer.from(signature, "base64url"),
      Buffer.from(canonical, "utf8"),
      await ed.getPublicKeyAsync(Buffer.from(SECRET.slice(2), "hex")),
    );
    expect(ok).toBe(true);
  });

  it("mints a fresh unpadded nonce each time", () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(Buffer.from(a, "base64url")).toHaveLength(16);
  });

  it("puts the sign in frame together as message type 29", async () => {
    const frame = await signinFrame({ apiKey: "token", secret: SECRET }, 143);
    expect(frame).toMatchObject({ mt: 29, chain_id: 143, api_key: "token" });
    expect(typeof frame.signature).toBe("string");
  });
});

describe("scaling", () => {
  it("scales by the market's decimals without touching a float", () => {
    expect(scale("1.5", 2)).toBe(150n);
    expect(scale("0.000001", 6)).toBe(1n);
    expect(scale("25", 0)).toBe(25n);
    expect(scale("1.230000", 2)).toBe(123n); // trailing zeros are not real precision
  });

  it("refuses precision the market cannot express", () => {
    expect(() => scale("1.005", 2)).toThrow(/finer than/);
    expect(() => scale("0.5", 0)).toThrow(/finer than/);
    expect(() => scale("-1", 2)).toThrow(/positive decimal/);
  });

  it("round trips", () => {
    expect(unscale(scale("12.34", 6), 6)).toBe("12.34");
    expect(unscale(25n, 0)).toBe("25");
  });
});

describe("short orders", () => {
  const ids = () => {
    let rq = 0;
    let sn = 0;
    return { nextRequestId: () => ++rq, nextSeq: () => ++sn };
  };

  it("opens a market short with a strictly increasing request id", () => {
    const { nextRequestId, nextSeq } = ids();
    const [entry, ...rest] = openShortFrames({ market: MON, size: "25" }, nextRequestId, nextSeq);
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ mt: 22, mkt: 10, t: ORDER_TYPE.openShort, p: 0, s: 25, rq: 1 });
  });

  it("stops a short out above the mark and takes profit below it", () => {
    const { nextRequestId, nextSeq } = ids();
    const frames = openShortFrames(
      { market: MON, size: "25", leverage: 1000, stopLoss: "0.03", takeProfit: "0.02" },
      nextRequestId,
      nextSeq,
      77,
    );
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({ t: ORDER_TYPE.openShort, lv: 1000 });
    // 0.03 at six decimals is 30000, and a short is stopped when the mark climbs to it.
    expect(frames[1]).toMatchObject({
      t: ORDER_TYPE.closeShort,
      tp: 30000,
      tpc: TRIGGER.gteMark,
      lp: 77,
      lb: 0,
    });
    expect(frames[2]).toMatchObject({ tp: 20000, tpc: TRIGGER.lteMark, lp: 77 });
    expect(new Set(frames.map((f) => f.rq)).size).toBe(3);
  });

  it("always carries the leverage and flags Perpl requires", () => {
    const { nextRequestId, nextSeq } = ids();
    // Both are required with no server-side default: an order missing either is refused with 400,
    // which is exactly how a short once reported success and never reached the exchange.
    const frames = openShortFrames(
      { market: MON, size: "25", stopLoss: "0.03" },
      nextRequestId,
      nextSeq,
    );
    for (const frame of frames) {
      expect(frame.lv).toBeGreaterThan(0);
      expect(frame.fl).toBe(FLAG_GTC);
    }
    expect(frames[0]?.lv).toBe(DEFAULT_LEVERAGE);
    expect(closeShortFrame(MON, "25", nextRequestId, nextSeq)).toMatchObject({
      lv: DEFAULT_LEVERAGE,
      fl: FLAG_GTC,
    });
  });

  it("carries the leverage it was given to the triggers too", () => {
    const { nextRequestId, nextSeq } = ids();
    const frames = openShortFrames(
      { market: MON, size: "25", leverage: 500, takeProfit: "0.02" },
      nextRequestId,
      nextSeq,
    );
    expect(frames.map((f) => f.lv)).toEqual([500, 500]);
  });

  it("sends sizes and prices as numbers, because a string kills the connection", () => {
    const { nextRequestId, nextSeq } = ids();
    const frames = openShortFrames(
      { market: MON, size: "372", stopLoss: "0.03" },
      nextRequestId,
      nextSeq,
    );
    for (const frame of frames) {
      expect(typeof frame.s).toBe("number");
      expect(typeof frame.p).toBe("number");
      if (frame.tp !== undefined) expect(typeof frame.tp).toBe("number");
    }
    expect(JSON.stringify(frames[0])).toContain('"s":372');
  });

  it("refuses a closed market and a zero size", () => {
    const { nextRequestId, nextSeq } = ids();
    expect(() =>
      openShortFrames({ market: { ...MON, isOpen: false }, size: "1" }, nextRequestId, nextSeq),
    ).toThrow(/closed on Perpl/);
    expect(() => openShortFrames({ market: MON, size: "0" }, nextRequestId, nextSeq)).toThrow(
      /above zero/,
    );
  });

  it("closes a short", () => {
    const { nextRequestId, nextSeq } = ids();
    expect(closeShortFrame(MON, "25", nextRequestId, nextSeq)).toMatchObject({
      t: ORDER_TYPE.closeShort,
      s: 25,
      mkt: 10,
    });
  });
});

describe("margin utilization", () => {
  it("reports locked over the whole balance", () => {
    expect(marginUtilization("750", "250")).toBe(25);
    expect(marginUtilization("0", "100")).toBe(100);
  });

  it("has nothing to report on an empty account", () => {
    expect(marginUtilization("0", "0")).toBeNull();
    expect(marginUtilization("nonsense", "0")).toBeNull();
  });
});

describe("the REST signing target", () => {
  const base = "https://app.perpl.xyz/api";

  it("signs the path relative to the API mount, dropping the prefix", () => {
    // Signing "/api/v1/..." instead is accepted by the transport and rejected by the signature,
    // which surfaces only as a bare 401.
    expect(signingTarget("https://app.perpl.xyz/api/v1/trading/fills?limit=1", base)).toBe(
      "/v1/trading/fills?limit=1",
    );
  });

  it("keeps the query exactly as sent and copes with a base that has no prefix", () => {
    expect(signingTarget("https://x.test/v1/a?b=1&c=2", "https://x.test")).toBe("/v1/a?b=1&c=2");
    expect(signingTarget("https://x.test/api/v1/a", "https://x.test/api/")).toBe("/v1/a");
  });

  it("leaves a path that does not start with the prefix alone", () => {
    expect(signingTarget("https://x.test/other/thing", "https://x.test/api")).toBe("/other/thing");
  });
});
