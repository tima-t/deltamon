import { logger } from "../lib/logger.js";
import { signinFrame, type PerplCredentials } from "./perplAuth.js";
import { marginUtilization, type OrderFrame } from "./perplOrders.js";

/**
 * One authenticated trading socket per manager account.
 *
 * Perpl publishes balances, orders and positions only over this socket, so the backend holds it
 * open and the console reads the last snapshot rather than every browser opening its own. That
 * also keeps the Ed25519 key here, which is the only place it is allowed to be.
 *
 * Message types, from websocket.md: 19 wallet snapshot, 21 account update, 23/24 orders, 26/27
 * positions, 29 sign in, 22 order request.
 */

const SNAPSHOT = { wallet: 19, account: 21, orders: 23, ordersUpdate: 24 } as const;
const POSITIONS = { snapshot: 26, update: 27 } as const;
const HEARTBEAT = 100;
/** Gateway acknowledgement for an order frame. code 0 is forwarded, 400 rejected, 403 read-only. */
const STATUS = 3;
/** How long to wait for that acknowledgement before giving up on it. */
const STATUS_TIMEOUT_MS = 8_000;

export interface OrderStatus {
  /** Our outbound `sn`, echoed back as `cid`. */
  sn: number;
  code: number;
  error: string | null;
  accepted: boolean;
}

export interface PerplPosition {
  market: number | null;
  size: string | null;
  side: "long" | "short" | null;
  entryPrice: string | null;
  collateral: string | null;
  unrealisedPnl: string | null;
  raw: Record<string, unknown>;
}

export interface PerplAccount {
  connected: boolean;
  /** False while Perpl has order forwarding off, in which case every order is rejected. */
  forwarding: boolean | null;
  availableBalance: string | null;
  lockedBalance: string | null;
  marginUtilizationPct: number | null;
  positions: PerplPosition[];
  openOrders: number;
  updatedAt: string | null;
  lastError: string | null;
  /** Perpl's numeric account id, which every order frame has to name. */
  accountId: number | null;
  /** The account the shared key actually trades, as Perpl reports it. */
  accountAddress: string | null;
  /** Chain head from the heartbeat, for order execution windows. */
  blockHeight: number | null;
}

const str = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v !== "") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
};

const num = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
};

/** Field names are read defensively: websocket.md pins the message types, not every key. */
export function toPosition(raw: Record<string, unknown>): PerplPosition {
  const size = str(raw, ["s", "size", "sz"]);
  // Perpl sends `sd` as a PositionType number (types.md: 1=Long, 2=Short), sizes unsigned.
  const declared = str(raw, ["side", "sd"]);
  const side =
    declared === "short" || declared === "2"
      ? "short"
      : declared === "long" || declared === "1"
        ? "long"
      : size !== null && size.startsWith("-")
        ? "short"
        : size !== null
          ? "long"
          : null;
  return {
    market: num(raw, ["mkt", "market", "market_id"]),
    size,
    side,
    entryPrice: str(raw, ["ep", "entry_price", "entryPrice"]),
    collateral: str(raw, ["c", "collateral", "col"]),
    unrealisedPnl: str(raw, ["pnl", "upnl", "unrealised_pnl", "unrealizedPnl"]),
    raw,
  };
}

export class PerplSession {
  private socket: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timer: NodeJS.Timeout | null = null;
  /**
   * Strictly increasing per account, and Perpl tells us where to start: `lfr` on the account is the
   * last request id it forwarded. Seeding from the clock instead overflows the field and the order
   * is dropped with no status at all, which is exactly how a short reported success and vanished.
   */
  private requestId = 0;
  private lastForwarded = 0;
  private seq = 0;
  /** Order frames waiting for their mt 3, keyed by the `sn` we sent. */
  private awaiting = new Map<number, (status: OrderStatus) => void>();
  /** Frame types we do not handle, logged once each so a protocol surprise is visible. */
  private seenTypes = new Set<number>();

  private state: PerplAccount = {
    connected: false,
    forwarding: null,
    availableBalance: null,
    lockedBalance: null,
    marginUtilizationPct: null,
    positions: [],
    openOrders: 0,
    updatedAt: null,
    lastError: null,
    accountId: null,
    accountAddress: null,
    blockHeight: null,
  };

  constructor(
    private readonly creds: PerplCredentials,
    private readonly chainId: number,
    private readonly url: string,
    private readonly label: string,
  ) {}

  account(): PerplAccount {
    return { ...this.state, positions: [...this.state.positions] };
  }

  start(): void {
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.state.connected = false;
  }

  private open(): void {
    if (this.closed || this.socket) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      this.fail(err);
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      void signinFrame(this.creds, this.chainId)
        .then((frame) => socket.send(JSON.stringify(frame)))
        .catch((err) => this.fail(err));
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      try {
        this.consume(JSON.parse(String(event.data)) as Record<string, unknown>);
      } catch {
        // A frame we cannot parse is not worth dropping the socket over.
      }
    });
    socket.addEventListener("error", () => this.fail(new Error("socket error")));
    socket.addEventListener("close", (event: { code: number; reason: string }) => {
      // 1011 means Perpl could not deserialize something we sent and tore the connection down
      // rather than answering. Silence here once cost hours, so every close is recorded.
      if (event.code !== 1000) {
        this.state.lastError = `socket closed ${event.code}${event.reason ? `: ${event.reason}` : ""}`;
        logger.warn(
          { code: event.code, reason: event.reason, account: this.label },
          "perpl closed the socket",
        );
      }
      this.socket = null;
      this.state.connected = false;
      this.schedule();
    });
  }

  private fail(err: unknown): void {
    this.state.lastError = err instanceof Error ? err.message : String(err);
    logger.warn({ err, account: this.label }, "perpl socket failed");
    this.socket = null;
    this.state.connected = false;
    this.schedule();
  }

  private schedule(): void {
    if (this.closed || this.timer) return;
    const wait = Math.min(30_000, 1_000 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, wait);
  }

  private consume(frame: Record<string, unknown>): void {
    const mt = typeof frame.mt === "number" ? frame.mt : null;
    if (mt === null) return;
    this.state.updatedAt = new Date().toISOString();

    if (mt === STATUS) {
      this.settle(frame);
      return;
    }

    if (mt === HEARTBEAT) {
      if (typeof frame.h === "number") this.state.blockHeight = frame.h;
      return;
    }

    if (mt === SNAPSHOT.wallet) {
      // The first frame after a successful sign in, so reaching it means auth worked.
      this.state.connected = true;
      this.state.lastError = null;
      this.retry = 0;
      if (typeof frame.addr === "string") this.state.accountAddress = frame.addr;
      this.applyAccounts(frame);
      return;
    }

    if (mt === SNAPSHOT.account) {
      this.applyAccounts(frame);
      return;
    }

    if (mt === POSITIONS.snapshot || mt === POSITIONS.update) {
      if (Array.isArray(frame.d)) {
        this.state.positions = frame.d.map((p) => toPosition(p as Record<string, unknown>));
      }
      return;
    }

    if (mt === SNAPSHOT.orders || mt === SNAPSHOT.ordersUpdate) {
      if (Array.isArray(frame.d)) this.state.openOrders = frame.d.length;
      // An order that failed on chain comes back here with a reason rather than as a status.
      for (const row of Array.isArray(frame.d) ? frame.d : []) {
        const order = row as Record<string, unknown>;
        if (order.fr !== undefined || order.sr !== undefined) {
          logger.warn({ fr: order.fr, sr: order.sr, account: this.label }, "perpl order failed");
        }
      }
      return;
    }

    if (!this.seenTypes.has(mt)) {
      this.seenTypes.add(mt);
      logger.info({ mt, frame, account: this.label }, "unhandled perpl frame type");
    }
  }

  /**
   * Balances live one level down, in the `as` array of account objects, not on the frame itself.
   * A key trades a single account, so the first entry is the one, but it is matched by id once
   * known so a second account appearing later cannot quietly swap under us.
   */
  private applyAccounts(frame: Record<string, unknown>): void {
    const rows = Array.isArray(frame.as) ? (frame.as as Record<string, unknown>[]) : [];
    if (rows.length === 0) return;
    const row =
      rows.find((r) => this.state.accountId !== null && r.id === this.state.accountId) ?? rows[0];
    if (!row) return;
    if (typeof row.id === "number") this.state.accountId = row.id;
    if (typeof row.fw === "boolean") this.state.forwarding = row.fw;
    if (typeof row.lfr === "number") this.lastForwarded = row.lfr;
    this.applyBalances(row);
  }

  private applyBalances(row: Record<string, unknown>): void {
    const available = str(row, ["b", "balance", "available"]);
    const locked = str(row, ["lb", "locked", "locked_balance"]);
    if (available !== null) this.state.availableBalance = available;
    if (locked !== null) this.state.lockedBalance = locked;
    if (this.state.availableBalance !== null && this.state.lockedBalance !== null) {
      this.state.marginUtilizationPct = marginUtilization(
        this.state.availableBalance,
        this.state.lockedBalance,
      );
    }
  }

  nextRequestId = (): number => {
    this.requestId = Math.max(this.requestId, this.lastForwarded) + 1;
    return this.requestId;
  };
  nextSeq = (): number => ++this.seq;

  accountId(): number | null {
    return this.state.accountId;
  }

  /** Resolves whichever order frame this status belongs to. */
  private settle(frame: Record<string, unknown>): void {
    const cid = typeof frame.cid === "number" ? frame.cid : null;
    const status = (frame.status ?? {}) as Record<string, unknown>;
    const code = typeof status.code === "number" ? status.code : -1;
    const error = typeof status.error === "string" ? status.error : null;
    if (code !== 0) {
      logger.warn({ cid, code, error, account: this.label }, "perpl rejected an order");
    }
    if (cid === null) return;
    const resolve = this.awaiting.get(cid);
    if (!resolve) return;
    this.awaiting.delete(cid);
    resolve({ sn: cid, code, error, accepted: code === 0 });
  }

  /**
   * Sends order frames and waits for the gateway to accept or reject each one.
   *
   * Sending is not success: Perpl answers every frame with an mt 3, and a malformed order is
   * refused there with a reason. Reporting "sent" without reading that reply is how an order can
   * look fine in the console and never exist on the exchange.
   */
  async submit(frames: OrderFrame[]): Promise<OrderStatus[]> {
    if (!this.socket || this.state.connected !== true) {
      throw new Error("not connected to Perpl");
    }
    if (this.state.forwarding === false) {
      throw new Error("Perpl has order forwarding off for this account, so orders are rejected");
    }
    if (this.state.accountId === null) {
      throw new Error("Perpl has not reported an account id yet");
    }

    const results: OrderStatus[] = [];
    for (const frame of frames) {
      const socket = this.socket;
      const settled = new Promise<OrderStatus>((resolve) => {
        this.awaiting.set(frame.sn, resolve);
        setTimeout(() => {
          if (!this.awaiting.delete(frame.sn)) return;
          resolve({
            sn: frame.sn,
            code: -1,
            error: "Perpl did not acknowledge the order",
            accepted: false,
          });
        }, STATUS_TIMEOUT_MS);
      });
      // Every order names the account; the socket knows it from the snapshot, the caller does not.
      socket.send(JSON.stringify({ ...frame, acc: this.state.accountId }));
      const status = await settled;
      results.push(status);
      // A rejected entry means its triggers would protect nothing, so stop here.
      if (!status.accepted) break;
    }
    return results;
  }
}

/** app.perpl.xyz/api becomes wss://app.perpl.xyz/ws/v1/trading. */
export function tradingSocketUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/ws/v1/trading";
  url.search = "";
  return url.toString();
}
