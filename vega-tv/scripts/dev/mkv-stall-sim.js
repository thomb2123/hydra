// Stall simulator for the MKV engine (shared/src/mkv/session.ts). Plays a real
// MKV through the engine against a fake Vega media pipeline: SourceBuffers with a
// byte quota and keyframe-accurate removal, a playback clock that only advances
// through time buffered in both audio and video, and fault injection.
//
//   ffmpeg -f lavfi -i testsrc=size=320x180:rate=24 -f lavfi -i sine -t 600 \
//     -c:v libx264 -preset ultrafast -b:v 1M -g 96 -c:a aac film.mkv
//   npx tsc --outDir /tmp/sim/new --module commonjs --target es2019 --skipLibCheck shared/src/mkv/session.ts
//   cp scripts/dev/mkv-stall-sim.js /tmp/sim/ && cd /tmp/sim
//   node mkv-stall-sim.js new <normal|error|quota|gap|seek> film.mkv 400
//
// Scenarios: error = one buffer write fails ~4 min in; quota = 2.5 MB buffer;
// gap = one piece silently lost; seek = jump from 100 s to 300 s.
// Results (18 Nov): the previous engine froze for good on "error", "quota" and
// "gap" (the 5-minute stall); this one plays through all of them.
// Plays a real MKV through the MKV engine against a simulated Vega media pipeline:
// SourceBuffers with a byte quota and keyframe-accurate removal, a playback clock
// that only advances through buffered (audio AND video) time, and fault injection.
const fs = require('fs');
const [,, which, scenario, file, mediaSeconds = '400'] = process.argv;
const SPEED = 10; // media seconds per real second
const FILE = fs.readFileSync(file);
const remux = require(`./${which}/remux.js`);
const times = new WeakMap();
const orig = remux.MkvRemuxer.prototype.fragment;
remux.MkvRemuxer.prototype.fragment = function (frames) {
  const out = orig.call(this, frames);
  if (out.end != null) {
    const t = {start: out.start ?? out.end, end: out.end};
    if (out.video) times.set(out.video, t);
    if (out.audio) times.set(out.audio, t);
  }
  return out;
};
global.XMLHttpRequest = class {
  open(_m, _u) {}
  setRequestHeader(_k, v) { const m = /bytes=(\d+)-(\d+)/.exec(v); this.s = +m[1]; this.e = +m[2]; }
  send() {
    this.t = setTimeout(() => {
      const b = FILE.subarray(this.s, Math.min(FILE.length, this.e + 1));
      this.status = 206;
      this.response = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
      this.onload();
    }, 15);
  }
  abort() { clearTimeout(this.t); this.onabort && this.onabort(); }
};
class Target {
  constructor() { this.l = {}; }
  addEventListener(n, f) { (this.l[n] = this.l[n] || []).push(f); }
  removeEventListener(n, f) { this.l[n] = (this.l[n] || []).filter((x) => x !== f); }
  emit(n) { for (const f of [...(this.l[n] || [])]) f(); }
}
const QUOTA = scenario === 'quota' ? 2.5e6 : 12e6;
let appends = 0;
class SB extends Target {
  constructor(kind) { super(); this.kind = kind; this.frags = []; this.updating = false; }
  get bytes() { return this.frags.reduce((s, f) => s + f.bytes, 0); }
  get buffered() {
    const fr = [...this.frags].sort((a, b) => a.start - b.start);
    const r = [];
    for (const f of fr) {
      const last = r[r.length - 1];
      if (last && f.start <= last.end + 0.05) last.end = Math.max(last.end, f.end); else r.push({start: f.start, end: f.end});
    }
    return {length: r.length, start: (i) => r[i].start, end: (i) => r[i].end, _r: r};
  }
  appendBuffer(data) {
    const t = times.get(data);
    if (t && this.bytes + data.length > QUOTA) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    this.updating = true;
    if (this.kind === 'video' && t) appends++;
    const fail = scenario === 'error' && this.kind === 'video' && t && appends === 60;
    setTimeout(() => {
      this.updating = false;
      if (fail) { this.emit('error'); return; }
      const drop = scenario === 'gap' && this.kind === 'video' && t && appends === 60;
      if (t && !drop) this.frags.push({...t, bytes: data.length});
      this.emit('updateend');
    }, 2);
  }
  remove(start, end) {
    this.updating = true;
    // Coded frames from start..end go, plus everything up to the next keyframe
    // (= the rest of any fragment that starts before `end`).
    this.frags = this.frags.filter((f) => !(f.start < end && f.end > start));
    setTimeout(() => { this.updating = false; this.emit('updateend'); }, 2);
  }
}
class MS extends Target {
  constructor() { super(); this.readyState = 'open'; this.sbs = []; }
  static isTypeSupported() { return true; }
  addSourceBuffer(mime) { const sb = new SB(/audio/.test(mime) ? 'audio' : 'video'); this.sbs.push(sb); return sb; }
  endOfStream() { this.readyState = 'ended'; }
}
const player = {currentTime: 0, paused: false, srcObject: null};
const logs = [];
const log = (l) => logs.push(`[${player.currentTime.toFixed(1)}] ${l}`);
(async () => {
  const {openMkv} = require(`./${which}/session.js`);
  const session = await openMkv(player, 'film.mkv', {log}, {MediaSource: MS});
  let stalledReal = 0, longest = 0, run = 0, sought = false;
  const started = Date.now();
  const tick = 10;
  await new Promise((done) => {
    const iv = setInterval(() => {
      const sbs = player.srcObject.sbs;
      const step = SPEED * tick / 1000;
      if (scenario === 'seek' && !sought && player.currentTime > 100) { sought = true; session.seek(300); }
      const t = player.currentTime;
      const ok = sbs.every((sb) => sb.buffered._r.some((r) => r.start <= t + 0.01 && r.end >= t + step));
      if (ok) { player.currentTime = t + step; run = 0; } else { stalledReal += tick; run += tick; longest = Math.max(longest, run); }
      if (player.currentTime >= +mediaSeconds || Date.now() - started > (+mediaSeconds / SPEED) * 1000 + 45000) { clearInterval(iv); done(); }
    }, tick);
  });
  session.unload();
  const maxBytes = Math.max(...player.srcObject.sbs.map((s) => s.bytes));
  console.log(JSON.stringify({which, scenario, reached: +player.currentTime.toFixed(1), target: +mediaSeconds, stalledMediaSec: +(stalledReal * SPEED / 1000).toFixed(1), longestStallRealSec: +(longest / 1000).toFixed(1), bufferMB: +(maxBytes / 1e6).toFixed(1)}));
  const interesting = logs.filter((l) => /stall|recover|restart|gap|failed|quota|pump/i.test(l));
  if (interesting.length) console.log('  ' + interesting.slice(0, 6).join('\n  '));
  process.exit(0);
})().catch((e) => { console.log(which, scenario, 'crashed', e); process.exit(1); });
