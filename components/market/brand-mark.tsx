import * as React from "react";

/**
 * The Attnn. logo mark: a cream rounded square with a gold dot, trailed by two
 * fading squares. Vector redraw of public/attnn-logo.jpeg (same proportions and
 * colours), so it stays sharp at any size and needs no background behind it:
 * the trailing squares are masked where the one in front overlaps them.
 *
 * Size it by height, e.g. className="h-7 w-auto". Decorative by default; pass
 * a `title` when the mark is the only label (it then gets role="img").
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const id = React.useId().replace(/:/g, "");
  // Geometry from the source image, in its pixels: squares are 200 wide with a
  // 24px stroke, offset 69 and 136 to the right; the dot has a 28px radius.
  const square = (x: number) => ({ x: x + 12, y: 12, width: 176, height: 176, rx: 30 });
  return (
    <svg
      viewBox="0 0 336 200"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        {/* Hide each trailing square wherever a square in front of it sits. */}
        <mask id={`${id}-m2`} maskUnits="userSpaceOnUse" x="0" y="0" width="336" height="200">
          <rect width="336" height="200" fill="white" />
          <rect x="0" y="0" width="200" height="200" rx="42" fill="black" />
        </mask>
        <mask id={`${id}-m3`} maskUnits="userSpaceOnUse" x="0" y="0" width="336" height="200">
          <rect width="336" height="200" fill="white" />
          <rect x="0" y="0" width="200" height="200" rx="42" fill="black" />
          <rect x="69" y="0" width="200" height="200" rx="42" fill="black" />
        </mask>
      </defs>
      <rect {...square(136)} fill="none" stroke="#3B3D3F" strokeWidth="24" mask={`url(#${id}-m3)`} />
      <rect {...square(69)} fill="none" stroke="#7F8082" strokeWidth="24" mask={`url(#${id}-m2)`} />
      <rect {...square(0)} fill="none" stroke="#FDFAF3" strokeWidth="24" />
      <circle cx="100" cy="100" r="28" fill="#FF9A04" />
    </svg>
  );
}
