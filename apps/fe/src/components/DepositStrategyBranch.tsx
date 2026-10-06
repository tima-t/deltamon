"use client";

/** The branch is a replayable explanation, never a claim of live allocation progress. */
export function DepositStrategyBranch({
  mapWidth,
  motionEnabled,
  replay,
  playing,
  automatic,
  onReplay,
  onReplayEnd,
}: {
  mapWidth: number;
  motionEnabled: boolean;
  replay: number;
  playing: boolean;
  automatic: boolean;
  onReplay: () => void;
  onReplayEnd: () => void;
}) {
  const center = mapWidth / 2;
  const branches = [
    { side: "long", end: mapWidth / 4 },
    { side: "short", end: (mapWidth * 3) / 4 },
  ].map(({ side, end }) => ({
    side,
    path: `M${center} 0 V8 C${center} 26 ${end} 14 ${end} 40`,
  }));

  return (
    <div className="deposit-strategy-branch" data-playing={playing}>
      <div className="deposit-strategy-fork" aria-hidden="true" key={replay}>
        <svg viewBox={`0 0 ${mapWidth} 40`}>
          {branches.map(({ side, path }) => (
            <g key={side} className={`deposit-strategy-${side}`}>
              <path className="deposit-strategy-branch-guide" d={path} />
              <path className="deposit-strategy-branch-ink" d={path} pathLength="1" />
              <path className="deposit-strategy-packet" d={path} pathLength="1" />
            </g>
          ))}
        </svg>
      </div>
      <div className="deposit-strategy-heading">
        <div>
          <p className="deposit-journey-map-label">VAULT STRATEGY / ILLUSTRATION</p>
          <h4>Put funds to work.</h4>
        </div>
        <button
          type="button"
          className="deposit-strategy-replay"
          disabled={!motionEnabled || playing}
          onClick={onReplay}
        >
          <span aria-hidden="true">↗</span>
          {playing
            ? motionEnabled
              ? "ILLUSTRATING…"
              : "ILLUSTRATION PAUSED"
            : automatic
              ? "REPLAY STRATEGY"
              : "PLAY STRATEGY"}
        </button>
      </div>
      <div className="deposit-strategy-legs" key={`legs-${replay}`}>
        <div className="deposit-strategy-leg deposit-strategy-long">
          <div className="deposit-strategy-art" aria-hidden="true">
            <svg viewBox="0 0 88 72">
              <path className="deposit-strategy-art-rule" d="M6 64 H82 M44 6 V64" />
              {[44, 32, 20].map((y, index) => (
                <g
                  key={y}
                  className="deposit-strategy-stake-disc"
                  style={{ animationDelay: `${1.8 + index * 0.12}s` }}
                >
                  <path d={`M18 ${y} v8 c0 12 52 12 52 0 v-8`} />
                  <ellipse cx="44" cy={y} rx="26" ry="9" />
                </g>
              ))}
              <path className="deposit-strategy-art-detail" d="M39 16 L44 12 L49 16 L44 20 Z" />
            </svg>
          </div>
          <div>
            <strong>Buy &amp; stake MON</strong>
            <p>Increase the staked MON position.</p>
            <span>ONCHAIN HOLDINGS</span>
          </div>
        </div>
        <div className="deposit-strategy-leg deposit-strategy-short">
          <div className="deposit-strategy-art" aria-hidden="true">
            <svg viewBox="0 0 88 72">
              <path className="deposit-strategy-art-rule" d="M6 64 H82 M12 8 V64" />
              <path
                className="deposit-strategy-short-area"
                d="M16 17 H29 V28 H44 V40 H59 V53 H75 V64 H16 Z"
              />
              <path
                className="deposit-strategy-short-line"
                d="M16 17 H29 V28 H44 V40 H59 V53 H75"
                pathLength="1"
              />
              <path className="deposit-strategy-art-detail" d="M71 49 L75 53 L79 49" />
            </svg>
          </div>
          <div>
            <strong>Increase the MON short</strong>
            <p>Offset the added MON exposure.</p>
            <span>MANAGER REPORT</span>
          </div>
        </div>
        {playing ? (
          <span
            className="deposit-strategy-timer"
            aria-hidden="true"
            onAnimationEnd={onReplayEnd}
          />
        ) : null}
      </div>
      <p className="deposit-strategy-note">Allocation happens separately from share issuance.</p>
    </div>
  );
}
