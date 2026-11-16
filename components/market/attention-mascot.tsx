"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * The Attnn. mark come to life: the logo's cream square is the face and its
 * orange dot is the eye. The dot looks at what the visitor is doing (a field,
 * a button, the pointer), blinks now and then, and reacts to a mood. Pair it
 * with <MascotBubble> to let it talk.
 *
 * Under reduced motion it sits still and only the words change.
 */

export type MascotMood = "idle" | "happy" | "busy" | "done" | "error";
/** A point in viewport pixels, or null for "no particular target". */
export type GazePoint = { x: number; y: number } | null;

/** How far the dot may move from the centre, in the mark's 200-unit space. */
const MAX_OFFSET = 36;
/** Screen distance (px) at which the dot reaches its edge. */
const REACH = 240;
/** The pointer counts as "being followed" for this long after it last moved. */
const POINTER_MEMORY_MS = 3500;

const MOOD_ANIM: Record<MascotMood, string> = {
  idle: "",
  happy: "mascot-nod",
  busy: "mascot-pulse",
  done: "mascot-hop",
  error: "",
};

export function AttentionMascot({
  size = 44,
  mood = "idle",
  gaze,
  aimKey,
  className,
}: {
  size?: number;
  mood?: MascotMood;
  /** Where to look right now. Return null to follow the pointer instead. */
  gaze?: () => GazePoint;
  /** Change it to make the mascot look again (after typing, focus moves, …). */
  aimKey?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const tileRef = React.useRef<SVGSVGElement>(null);
  const pupilRef = React.useRef<SVGCircleElement>(null);
  const gazeRef = React.useRef(gaze);
  const look = React.useRef({ dx: 0, dy: 0, blink: false, pointer: null as GazePoint, pointerAt: 0, glance: null as GazePoint });

  React.useLayoutEffect(() => {
    gazeRef.current = gaze;
  });

  const paint = React.useCallback(() => {
    const el = pupilRef.current;
    if (!el) return;
    const s = look.current;
    el.style.transform = `translate(${s.dx.toFixed(1)}px, ${s.dy.toFixed(1)}px) scale(1, ${s.blink ? 0.12 : 1})`;
  }, []);

  const aim = React.useCallback(() => {
    const tile = tileRef.current;
    if (!tile) return;
    const s = look.current;
    if (reduced) {
      s.dx = 0;
      s.dy = 0;
      return paint();
    }
    const r = tile.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pointer = s.pointer && performance.now() - s.pointerAt < POINTER_MEMORY_MS ? s.pointer : null;
    const target = gazeRef.current?.() ?? pointer ?? s.glance;
    if (!target) {
      s.dx = 0;
      s.dy = 0;
    } else {
      const vx = target.x - cx;
      const vy = target.y - cy;
      const d = Math.hypot(vx, vy) || 1;
      const k = (Math.min(1, d / REACH) * MAX_OFFSET) / d;
      s.dx = vx * k;
      s.dy = vy * k;
    }
    paint();
  }, [paint, reduced]);

  // Look again whenever the caller's situation or the mood changes.
  React.useEffect(() => {
    aim();
  }, [aim, aimKey, mood]);

  // Follow the pointer, and keep the gaze right while the page scrolls or resizes.
  React.useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), aim()));
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      look.current.pointer = { x: e.clientX, y: e.clientY };
      look.current.pointerAt = performance.now();
      schedule();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // When the pointer goes quiet, drift back to the visitor.
    const settle = window.setInterval(schedule, 1000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(settle);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [aim, reduced]);

  // Blink every few seconds (sometimes twice), and glance around when nothing is going on.
  React.useEffect(() => {
    if (reduced) return;
    const timers = new Set<number>();
    const later = (ms: number, fn: () => void) => {
      const t = window.setTimeout(() => (timers.delete(t), fn()), ms);
      timers.add(t);
    };
    const blink = (times: number) => {
      look.current.blink = true;
      paint();
      later(120, () => {
        look.current.blink = false;
        paint();
        if (times > 1) later(140, () => blink(times - 1));
      });
    };
    const scheduleBlink = () =>
      later(2600 + Math.random() * 3600, () => {
        blink(Math.random() < 0.2 ? 2 : 1);
        scheduleBlink();
      });
    const scheduleGlance = () =>
      later(4200 + Math.random() * 3800, () => {
        const s = look.current;
        const idle = !s.pointer || performance.now() - s.pointerAt > POINTER_MEMORY_MS;
        const tile = tileRef.current;
        if (idle && tile && !gazeRef.current?.()) {
          const r = tile.getBoundingClientRect();
          const side = Math.random() < 0.5 ? -1 : 1;
          s.glance = { x: r.left + r.width / 2 + side * (120 + Math.random() * 160), y: r.top + r.height / 2 + (Math.random() - 0.5) * 140 };
          aim();
          later(900 + Math.random() * 500, () => {
            s.glance = null;
            aim();
          });
        }
        scheduleGlance();
      });
    scheduleBlink();
    scheduleGlance();
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [aim, paint, reduced]);

  return (
    <svg
      ref={tileRef}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={cn("flex-none overflow-visible", mood === "error" && !reduced && "mascot-shake", className)}
    >
      <rect
        x="12"
        y="12"
        width="176"
        height="176"
        rx="30"
        fill="rgb(var(--ink-1))"
        stroke={mood === "error" ? "var(--c-down)" : "rgb(var(--cream))"}
        strokeWidth="22"
        className="transition-[stroke] duration-300"
      />
      {/* key restarts the mood's one-shot animation each time the mood changes */}
      <g key={mood} className={cn("mascot-g", !reduced && MOOD_ANIM[mood])}>
        <circle ref={pupilRef} cx="100" cy="100" r="28" fill="var(--c-signal)" className="mascot-pupil" />
      </g>
    </svg>
  );
}

/** The mascot's speech bubble. Screen readers hear each new line once (polite live region). */
export function MascotBubble({ children, className }: { children: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("min-w-0", className)}>
      <p
        key={children}
        className="bubble-pop relative inline-block rounded-[14px] bg-text-primary px-3.5 py-2 text-sm font-medium leading-snug text-arc-bg-0 shadow-raised before:absolute before:-left-1 before:top-1/2 before:h-2.5 before:w-2.5 before:-translate-y-1/2 before:rotate-45 before:rounded-[2px] before:bg-text-primary"
      >
        {children}
      </p>
    </div>
  );
}
