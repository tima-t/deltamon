import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(async () => undefined),
  createIndex: vi.fn(async () => "index"),
  constructor: vi.fn(),
}));
vi.mock("../src/config.js", () => ({
  env: { MONGO_CONNECTION_STRING: "mongodb://test", MONGO_DB_NAME: "accounting-test" },
}));
vi.mock("../src/lib/logger.js", () => ({ logger: { info: vi.fn() } }));
vi.mock("mongodb", () => ({
  MongoClient: class {
    constructor() {
      mocks.constructor();
    }
    connect = mocks.connect;
    close = mocks.close;
    db() {
      return { collection: () => ({ createIndex: mocks.createIndex }) };
    }
  },
}));
const { db, closeMongo } = await import("../src/lib/mongo.js");

afterEach(async () => {
  await closeMongo();
  vi.clearAllMocks();
});

describe("persistent accounting connection recovery", () => {
  it("retries after a temporary connection failure rather than poisoning future collection ticks", async () => {
    mocks.connect
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValue(undefined);
    await expect(db()).rejects.toThrow("temporarily unavailable");
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await expect(db()).resolves.toBeDefined();
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
  });

  it("does not expose a database before its accounting indexes are ready", async () => {
    mocks.connect.mockResolvedValue(undefined);
    mocks.createIndex.mockRejectedValueOnce(new Error("index unavailable"));
    await expect(db()).rejects.toThrow("index unavailable");
    const [first, second] = await Promise.all([db(), db()]);
    expect(first).toBe(second);
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    expect(mocks.createIndex.mock.calls.slice(1, 4)).toEqual([
      [{ scope: 1, at: 1 }, { name: "accounting_timeline" }],
      [{ scope: 1, at: 1 }, { name: "accounting_timeline" }],
      [{ scope: 1, at: 1 }, { name: "accounting_timeline" }],
    ]);
  });
});
