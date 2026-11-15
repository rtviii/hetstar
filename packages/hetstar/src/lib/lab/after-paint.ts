/**
 * Run `work` once the browser has painted a whole frame: a pass that holds the main thread
 * starts only after its loading mark is on screen and its animation is with the compositor.
 */
export function afterPaint(work: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(work, 0)));
}
