// A stopwatch for one operation of the viewer (a switch of the main view), off unless asked
// for: set localStorage["hetstar.timing"] = "1" in the console, or open the page with
// ?hetstar-timing. Each operation prints one table to the console: the steps in the order
// they ended, the time each took and the time since the start.

interface Run {
  label: string;
  start: number;
  last: number;
  steps: { step: string; ms: number; "since start": number }[];
}

let run: Run | null = null;

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("hetstar.timing") === "1" || window.location.search.includes("hetstar-timing");
  } catch {
    return false;
  }
}

export const timing = {
  /** start timing an operation; one already running is dropped */
  begin(label: string): void {
    if (!enabled()) return;
    const now = performance.now();
    run = { label, start: now, last: now, steps: [] };
  },
  /** a step of the running operation just ended */
  mark(step: string): void {
    if (!run) return;
    const now = performance.now();
    run.steps.push({ step, ms: Math.round(now - run.last), "since start": Math.round(now - run.start) });
    run.last = now;
  },
  running(): boolean {
    return run !== null;
  },
  /** the operation is over: print it */
  end(step: string): void {
    if (!run) return;
    timing.mark(step);
    console.log(`[hetstar timing] ${run.label}: ${Math.round(run.last - run.start)} ms`);
    console.table(run.steps);
    run = null;
  },
};
