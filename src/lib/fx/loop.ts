// Shared plumbing for the canvas backgrounds.

/** Draws one frame. `t` is ms since start, `dt` ms since the last frame (capped). */
export type Frame = (t: number, dt: number) => void;

/** Starts an animated background on `canvas`; returns a cleanup function. */
export type FxEngine = (canvas: HTMLCanvasElement, opts: { animate: boolean }) => () => void;

/**
 * rAF loop that sleeps while the tab is hidden — a new-tab page spends most of
 * its life in a background tab, and rAF alone still ticks in some cases.
 */
export function runLoop(frame: Frame): () => void {
  let id = 0;
  let last = 0;
  const step = (t: number) => {
    frame(t, Math.min(50, t - last));
    last = t;
    id = requestAnimationFrame(step);
  };
  const start = () => {
    cancelAnimationFrame(id);
    last = performance.now();
    id = requestAnimationFrame(step);
  };
  const onVisibility = () => (document.hidden ? cancelAnimationFrame(id) : start());
  document.addEventListener('visibilitychange', onVisibility);
  if (!document.hidden) start();
  return () => {
    cancelAnimationFrame(id);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** Background clicks only: a ripple on every button press would be noise. */
export function isBackgroundClick(e: PointerEvent): boolean {
  const t = e.target as Element | null;
  return e.button === 0 && !t?.closest('a, button, input, select, textarea, label, dialog, [popover], [data-card-id], .drawer');
}
