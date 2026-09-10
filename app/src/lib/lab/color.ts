// Small color helpers shared by the 1D track lanes and the 2D slice renderer.

export function hexToRgb(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

/** CSS hex string of a numeric color (0xcc9966 -> "#cc9966"). */
export function hexCss(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

/** Piecewise-linear interpolation through hex color stops; t clamped to [0, 1]. */
export function rampColor(stops: number[], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function rampCss(stops: number[], t: number): string {
  const [r, g, b] = rampColor(stops, t);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
