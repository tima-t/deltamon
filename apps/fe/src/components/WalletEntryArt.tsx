export function WalletEntryArt() {
  return (
    <div className="wallet-entry-art" aria-hidden="true">
      <div className="wallet-entry-art-head">
        <span>DELTAMON / ACCESS</span>
        <span>STRATEGY 01</span>
      </div>
      <div className="wallet-entry-art-stage">
        <svg viewBox="0 0 360 420" fill="none" focusable="false">
          <defs>
            <pattern id="wallet-entry-grain" width="13" height="13" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="4" r="0.55" className="wallet-entry-grain-dot" />
              <circle cx="10" cy="11" r="0.45" className="wallet-entry-grain-dot" />
            </pattern>
            <filter id="wallet-entry-shadow" x="-30%" y="-30%" width="160%" height="180%">
              <feDropShadow
                dx="10"
                dy="14"
                stdDeviation="9"
                floodColor="#3b2838"
                floodOpacity="0.2"
              />
            </filter>
          </defs>
          <rect width="360" height="420" fill="url(#wallet-entry-grain)" />
          <circle cx="179" cy="207" r="148" className="wallet-entry-orbit" />
          <circle
            cx="179"
            cy="207"
            r="111"
            className="wallet-entry-orbit wallet-entry-orbit-inner"
          />
          <path
            d="M179 45V59M179 355V369M17 207H31M327 207H341"
            className="wallet-entry-register"
          />
          <path d="M179 81V324M58 207H300" className="wallet-entry-axis" />
          <g className="wallet-entry-sculpture" filter="url(#wallet-entry-shadow)">
            <path d="M177 181V336" className="wallet-entry-stem" />
            <path d="M126 340C152 334 204 334 230 340" className="wallet-entry-base" />
            <path d="M60 191L300 145" className="wallet-entry-beam" />
            <path d="M68 191V258M292 147V249" className="wallet-entry-string" />
            <path d="M181 164L196 176L183 191L169 179Z" className="wallet-entry-pivot" />
            <path
              d="M66 252C80 248 100 254 109 267C122 285 114 309 96 319C78 330 50 322 41 305C30 283 44 259 66 252Z"
              className="wallet-entry-violet-weight"
            />
            <path
              d="M273 248C288 239 308 245 315 261L321 293C323 307 312 318 296 320L273 319C256 317 249 302 253 286L258 264C261 255 265 251 273 248Z"
              className="wallet-entry-amber-weight"
            />
            <path
              d="M58 274C69 265 83 263 96 266M269 264L300 258"
              className="wallet-entry-weight-detail"
            />
            <circle cx="72" cy="287" r="5" className="wallet-entry-weight-mark" />
            <path d="M280 289H298" className="wallet-entry-weight-mark-line" />
          </g>
          <path d="M24 380H336" className="wallet-entry-register" />
        </svg>
      </div>
      <div className="wallet-entry-art-foot">
        <span>ILLUSTRATIVE COUNTERWEIGHT</span>
        <span>NOT LIVE DATA</span>
      </div>
    </div>
  );
}
