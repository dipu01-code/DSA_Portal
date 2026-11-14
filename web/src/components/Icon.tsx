/** Inline stroke icons in currentColor, so they follow the theme. Decorative: label the button, not the icon. */
const PATHS = {
  lock: 'M6 11V8a6 6 0 0 1 12 0v3 M5 11h14v10H5z',
  check: 'M4 12l5 5L20 6',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  sun: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  chevron: 'M6 9l6 6 6-6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
