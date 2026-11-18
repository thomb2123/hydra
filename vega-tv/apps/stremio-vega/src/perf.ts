// Stutter detector: a light timer that notices when the app's JavaScript thread was
// blocked (focus moves and animations freeze while it is). Blocks over 120 ms are
// written to the device log with the screen they happened on, so scrolling can be
// measured on the stick rather than judged by eye. Costs one timer tick every 100 ms.
const TICK_MS = 100;
const REPORT_MS = 120;

let where = 'start';
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let worst = 0;
let count = 0;
let windowStart = 0;

/** The screen in front, for the log. */
export function perfScreen(name: string): void {
  where = name;
}

export function startPerfMonitor(log: (line: string) => void = (l) => console.log(`[stremio] ${l}`)): void {
  if (timer) {
    return;
  }
  last = Date.now();
  windowStart = last;
  timer = setInterval(() => {
    const now = Date.now();
    const late = now - last - TICK_MS;
    last = now;
    // A gap of many seconds is the app being paused in the background, not a stutter.
    if (late > REPORT_MS && late < 10000) {
      count++;
      worst = Math.max(worst, late);
      log(`perf: blocked ${late} ms on ${where}`);
    }
    if (now - windowStart >= 60000) {
      if (count) {
        log(`perf: last minute ${count} stutter(s), worst ${worst} ms`);
      }
      windowStart = now;
      count = 0;
      worst = 0;
    }
  }, TICK_MS);
}

export function stopPerfMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
