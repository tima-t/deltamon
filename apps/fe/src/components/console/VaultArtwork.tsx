/** Printed strategy emblem; decorative geometry never encodes live holdings or status. */
export function VaultArtwork() {
  return (
    <svg className="console-vault-art" viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <circle cx="120" cy="120" r="85" stroke="currentColor" strokeOpacity=".25" />
      <circle
        cx="120"
        cy="120"
        r="75"
        stroke="currentColor"
        strokeOpacity=".4"
        strokeDasharray="1 6"
      />
      <path d="M120 24v18m0 156v18M24 120h18m156 0h18" stroke="currentColor" />
      <path d="m120 58 54 31v62l-54 31-54-31V89z" stroke="currentColor" strokeWidth="2" />
      <path d="m120 73 41 24v46l-41 24-41-24V97z" fill="currentColor" fillOpacity=".08" />
      <path d="m120 91 25 14v30l-25 14-25-14v-30z" fill="currentColor" />
      <path d="m120 104 13 8v16l-13 8-13-8v-16z" fill="var(--print-paper, #fff9e9)" />
      <path
        d="M30 46V30h16m148 0h16v16M30 194v16h16m148 0h16v-16"
        stroke="currentColor"
        strokeOpacity=".5"
      />
    </svg>
  );
}
