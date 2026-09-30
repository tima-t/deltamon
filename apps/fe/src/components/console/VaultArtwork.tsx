import { useId } from "react";

/** Decorative strategy seal. Its geometry does not encode a position or live balance. */
export function VaultArtwork() {
  const id = useId();
  return (
    <svg className="console-vault-art" viewBox="0 0 460 300" fill="none" aria-hidden="true">
      <defs>
        <pattern id={`${id}-lines`} width="9" height="9" patternUnits="userSpaceOnUse">
          <path d="M0 9 9 0" stroke="#C9B1EF" strokeOpacity=".13" strokeWidth="1" />
        </pattern>
        <linearGradient
          id={`${id}-metal`}
          x1="120"
          y1="25"
          x2="340"
          y2="284"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#E8D7FF" />
          <stop offset=".43" stopColor="#AE83E6" />
          <stop offset="1" stopColor="#66469C" />
        </linearGradient>
        <linearGradient
          id={`${id}-core`}
          x1="160"
          y1="72"
          x2="305"
          y2="260"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F7EBD4" />
          <stop offset="1" stopColor="#C69A60" />
        </linearGradient>
      </defs>
      <circle cx="230" cy="150" r="132" stroke="#BBA5DD" strokeOpacity=".28" />
      <circle
        cx="230"
        cy="150"
        r="112"
        stroke="#BBA5DD"
        strokeOpacity=".27"
        strokeDasharray="2 7"
      />
      <circle cx="230" cy="150" r="91" stroke="#BBA5DD" strokeOpacity=".23" />
      <path d="M230 18v33m0 198v33M98 150h33m198 0h33" stroke="#D4BDEF" strokeOpacity=".5" />
      <path
        d="M230 42 334 103v94l-104 61-104-61v-94L230 42Z"
        fill={`url(#${id}-lines)`}
        stroke="#E8D7FF"
        strokeOpacity=".75"
        strokeWidth="1.5"
      />
      <path d="M230 59 317 110v80l-87 51-87-51v-80l87-51Z" fill={`url(#${id}-metal)`} />
      <path
        d="M230 76 300 117v66l-70 41-70-41v-66l70-41Z"
        fill="#32233F"
        stroke="#F5E6FF"
        strokeOpacity=".75"
      />
      <path d="M230 94 285 126v48l-55 32-55-32v-48l55-32Z" fill={`url(#${id}-core)`} />
      <path d="M230 112 269 135v30l-39 23-39-23v-30l39-23Z" fill="#3E2B48" />
      <path d="m230 124 28 16v20l-28 16-28-16v-20l28-16Z" stroke="#F7EBD4" strokeWidth="1.5" />
      <circle cx="230" cy="150" r="6" fill="#F7EBD4" />
      <circle cx="230" cy="18" r="3" fill="#DDBD76" />
      <circle cx="362" cy="150" r="3" fill="#DDBD76" />
      <circle cx="230" cy="282" r="3" fill="#DDBD76" />
      <circle cx="98" cy="150" r="3" fill="#DDBD76" />
      <path
        d="M43 43h46m-46 0v32m328-32h46m0 0v32M43 257h46m-46 0v-32m328 32h46m0 0v-32"
        stroke="#BBA5DD"
        strokeOpacity=".3"
      />
    </svg>
  );
}
