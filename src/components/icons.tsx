type P = { className?: string };

const Stroke = ({ className, d }: P & { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className ?? "h-5 w-5"} aria-hidden>
    <path d={d} />
  </svg>
);

/** A bookmark ribbon with a notched tail. */
export const RibbonMark = ({ className }: P) => (
  <svg viewBox="0 0 24 32" className={className} aria-hidden fill="currentColor">
    <path d="M4 0h16v31l-8-7-8 7z" />
  </svg>
);

export const Back = (p: P) => <Stroke {...p} d="M15 5l-7 7 7 7" />;
export const Contents = (p: P) => <Stroke {...p} d="M4 6h16M4 12h11M4 18h14" />;
export const Close = (p: P) => <Stroke {...p} d="M6 6l12 12M18 6L6 18" />;
export const Plus = (p: P) => <Stroke {...p} d="M12 5v14M5 12h14" />;
export const More = (p: P) => <Stroke {...p} d="M5 12h.01M12 12h.01M19 12h.01" />;
export const Sun = (p: P) => (
  <Stroke {...p} d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
);
export const Moon = (p: P) => <Stroke {...p} d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />;
export const Type = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5"} aria-hidden fill="currentColor">
    <text x="1" y="18" fontFamily="Literata, Georgia, serif" fontSize="17" fontWeight="500">A</text>
    <text x="13" y="18" fontFamily="Literata, Georgia, serif" fontSize="11" fontWeight="500">a</text>
  </svg>
);
