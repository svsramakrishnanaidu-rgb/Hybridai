"use client";

/** Inline icon set — no icon dependency, consistent 1.5px stroke. */

type P = { size?: number; className?: string };

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconMenu = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);

export const IconSend = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const IconStop = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconMic = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const IconCamera = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="3" y="7" width="12" height="10" rx="2" />
    <path d="M15 11l6-3v8l-6-3z" />
  </svg>
);

export const IconEye = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconHand = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6.5a1.5 1.5 0 0 1 3 0V13" />
    <path d="M17 10.5a1.6 1.6 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.6a6 6 0 0 1-4.8-2.4L4 15.4a1.7 1.7 0 0 1 2.6-2.1L8 14.6" />
  </svg>
);

export const IconScan = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" />
  </svg>
);

export const IconChat = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H8L4 22v-4.3A7.5 7.5 0 0 1 4.5 4.5h8A7.5 7.5 0 0 1 20 12z" />
  </svg>
);

export const IconFolder = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z" />
  </svg>
);

export const IconSettings = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.8a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.1a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 10.5 3V2.8a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1.5z" />
  </svg>
);

export const IconPlus = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconNote = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M6 3.5h9L19 8v12.5H6z" />
    <path d="M14.5 3.5V8H19M9 12h6M9 15.5h6" />
  </svg>
);

export const IconPaperclip = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M20 11.5 12.3 19a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.3-7.3" />
  </svg>
);

export const IconClose = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconInsight = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 18V9M9 18V5M14 18v-6M19 18v-9" />
  </svg>
);

export const IconCopy = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

export const IconVolume = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
  </svg>
);

export const IconVolumeOff = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M16 9l5 6M21 9l-5 6" />
  </svg>
);

export const IconSpark = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconCheck = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4.5 12.5 9 17l10.5-10.5" />
  </svg>
);

export const IconChip = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    <circle cx="12" cy="12" r="1.6" />
  </svg>
);

export const IconNetwork = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="5" r="2.2" />
    <circle cx="5" cy="18" r="2.2" />
    <circle cx="19" cy="18" r="2.2" />
    <path d="M10.6 6.8 6.4 15.9M13.4 6.8l4.2 9.1M7.2 18h9.6" />
  </svg>
);

export const IconLayers = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="m12 3 9 4.6-9 4.6-9-4.6L12 3Z" />
    <path d="m3.4 12.3 8.6 4.4 8.6-4.4M3.4 16.8l8.6 4.4 8.6-4.4" />
  </svg>
);

export const IconDatabase = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <ellipse cx="12" cy="6" rx="7.5" ry="3.2" />
    <path d="M4.5 6v12c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2V6" />
    <path d="M4.5 12c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2" />
  </svg>
);

export const IconBolt = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M13.5 2.5 5 13.6h5.4L9.9 21.5 19 10.2h-5.6l.1-7.7Z" />
  </svg>
);

export const IconShield = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 3 5 5.8v5.5c0 4.2 2.9 7.7 7 9.7 4.1-2 7-5.5 7-9.7V5.8L12 3Z" />
    <path d="m9 11.8 2.1 2.2 4-4.2" />
  </svg>
);

export const IconChart = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 20V4M4 20h16" />
    <path d="M8.5 16v-4M12.5 16V8M16.5 16v-6" />
  </svg>
);

export const IconGear = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 2.8v2.6M12 18.6v2.6M4.5 12H1.9M22.1 12h-2.6M6.7 6.7 4.9 4.9M19.1 19.1l-1.8-1.8M6.7 17.3l-1.8 1.8M19.1 4.9l-1.8 1.8" />
  </svg>
);

export const IconPlay = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M7.5 4.8 19 12 7.5 19.2V4.8Z" />
  </svg>
);

export const IconGlobe = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.4 4.1 5.6 4.1 9S14.6 18.6 12 21c-2.6-2.4-4.1-5.6-4.1-9S9.4 5.4 12 3Z" />
  </svg>
);

export const IconBrain = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 5.2a3 3 0 0 0-5.6 1.3A3.1 3.1 0 0 0 4.6 12a3.2 3.2 0 0 0 1.9 5.4A3 3 0 0 0 12 18.8V5.2Z" />
    <path d="M12 5.2a3 3 0 0 1 5.6 1.3A3.1 3.1 0 0 1 19.4 12a3.2 3.2 0 0 1-1.9 5.4A3 3 0 0 1 12 18.8" />
    <path d="M12 9.5h2.4M12 13.5h-2.6" />
  </svg>
);

export const IconWave = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M3 12h1.6M7 8.4v7.2M10.6 4.6v14.8M14.2 7.2v9.6M17.8 10v4M21.4 12H23" />
  </svg>
);

export const IconCube = ({ size, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 2.8 20.4 7v10L12 21.2 3.6 17V7L12 2.8Z" />
    <path d="M3.6 7 12 11.4 20.4 7M12 11.4v9.8" />
  </svg>
);
