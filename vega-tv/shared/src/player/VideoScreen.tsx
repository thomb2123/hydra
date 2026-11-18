// Full-screen player built on Vega's W3C media API, with a streaming-service
// style HUD: title at the top, a seek bar with time remaining, preview-then-jump
// scrubbing, a small button row and a subtitles side panel.
//
// - Progressive files (MP4, MKV, WebM, MPEG-TS, AVI, MOV, FLV) play in URL mode,
//   decoded by the platform's GStreamer pipeline with hardware video decoding.
// - HLS/DASH need MSE mode and a JS player registered in ./adaptive.
// - Seeks are verified. When the platform refuses to seek a source (seen with
//   some redirected debrid links), playback moves to `source.altUrl` (the same
//   file through the PC's Stremio server) and the seek is repeated there.
// - External SRT/VTT subtitles are fetched, parsed in JS and drawn as a text
//   overlay timed against currentTime (Vega lists addTextTrack as unsupported).
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {KeplerCaptionsView, KeplerVideoSurfaceView, MediaSource as W3CMediaSource, VideoPlayer, VTTCue} from '@amazon-devices/react-native-w3cmedia';
import {EmbeddedSubtitleTrack, MkvSession, openMkv} from '../mkv/session';
import {RemoteKey, useBackHandler, useRemoteKeys} from '../tv/remote';
import {AdaptiveSession, adaptivePlayer, deliveryKind} from './adaptive';
import {Cue, cueTextAt, looksLikeSubtitles, parseSubtitles, rescaleCues} from '../subtitles';
import {hostOf, request} from '../net';
import {detectFrameRate, matchDisplayTo, resetDisplay, standardRate} from './frameRate';

export interface ExternalSubtitle {
  id: string;
  label: string;
  language?: string;
  url: string;
  /** Tried when `url` fails, e.g. the direct address when `url` goes through a proxy. */
  fallbackUrl?: string;
  /** Frame rate the subtitle was timed for (fixes drift when it differs from the video). */
  fps?: number;
  /** Inline subtitle text; skips the download when present. */
  text?: string;
}

export interface PlaySource {
  url: string;
  /** Same media through another route (e.g. the PC's Stremio server), used if seeking fails. */
  altUrl?: string;
  title: string;
  /** Second title line, e.g. "S1:E3 · Episode name". */
  subtitle?: string;
  mime?: string;
  live?: boolean;
  startAt?: number;
  subtitles?: ExternalSubtitle[];
  /** Quality summary, e.g. "4K · HDR10 · Dolby Atmos". */
  detail?: string;
  /** With onFailed: give up if playback has not started within this time. */
  startTimeoutMs?: number;
  /** Video frame rate, when known (from a server probe). */
  videoFps?: number;
  /** Play through the in-app Matroska engine (set when a skip in the platform player failed). */
  engine?: boolean;
  /** Skip the engine: straight into the platform player (no skipping inside MKV there). */
  directOnly?: boolean;
}

/**
 * Follows an add-on link's redirect to the real download address (one tiny ranged
 * request), so the player talks to the file server directly. Falls back to the link itself.
 */
function resolveRedirect(url: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let done = false;
    const finish = (value: string) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        try {
          xhr.abort();
        } catch {
          // already finished
        }
        resolve(value);
      }
    };
    const timer = setTimeout(() => finish(url), timeoutMs);
    // The platform reports the final address only once the (one-byte) response has loaded.
    xhr.onload = () => {
      const final = String((xhr as any).responseURL || '');
      finish(/^https?:\/\//i.test(final) && xhr.status < 400 ? final : url);
    };
    xhr.onerror = () => finish(url);
    try {
      // Same shape as the engine's reads (binary, a real range): the platform completes
      // these promptly and reports where the redirect led.
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.setRequestHeader('Range', 'bytes=0-65535');
      xhr.send();
    } catch {
      finish(url);
    }
  });
}

export interface VideoScreenProps {
  source: PlaySource;
  onExit: () => void;
  onEnded?: () => void;
  /** Called about every 10 s and on exit with the position in seconds. */
  onProgress?: (position: number, duration: number) => void;
  /** Lets a caller log diagnostics. */
  onLog?: (line: string) => void;
  /** Live TV zapping: ▲/▼ and Channel +/- switch channel (step +1/-1); Menu opens subtitles. */
  onZap?: (step: number) => void;
  /** Called instead of showing an error when this source fails before it starts playing. */
  onFailed?: (reason: string) => void;
  /** Called once, when this source first starts playing (with the picture size when known). */
  onStarted?: (info: {width: number; height: number}) => void;
  /** Live TV draws its own channel banner: hide the built-in controls and title bar. */
  chromeless?: boolean;
  /** Replaces OK/Select (e.g. show live TV's now/next banner instead of pausing). */
  onInfo?: () => void;
  /** Replaces the Menu (☰) key action, e.g. live TV's source list. */
  onMenu?: () => void;
  /** Ignore remote keys and Back (another layer, such as a source list, has the remote). */
  inputLocked?: boolean;
  /** Shows a "Next Episode" button and plays it automatically at the end. */
  onNext?: () => void;
  nextLabel?: string;
  /** Subtitle language to switch on automatically (best-ranked match), or null/undefined for off. */
  preferredSubtitle?: string | null;
  /** Reports the viewer's subtitle choice (language, or null for off) so it can be remembered. */
  onSubtitleChosen?: (language: string | null) => void;
  /**
   * Seeking failed on `fromUrl`: the caller should reopen `source.altUrl` starting at
   * `position`. Without this prop the player switches route internally.
   */
  onRouteSwitched?: (fromUrl: string, position: number) => void;
  /** The platform player could not jump in this file: reopen it in the in-app engine at `position`. */
  onUseEngine?: (position: number) => void;
  /** The film keeps rebuffering at `position`: the connection cannot carry this version. */
  onTooSlow?: (position: number) => void;
}

const ACCENT = '#7b5cff';

const MEDIA_ERRORS: Record<number, string> = {
  1: 'Playback was stopped.',
  2: 'The connection to this video was lost.',
  3: 'This video could not be decoded.',
  4: 'This video format is not supported.',
};

let vttInstalled = false;
function installVttCue() {
  if (vttInstalled) {
    return;
  }
  const g: any = globalThis as any;
  g.VTTCue = VTTCue;
  if (g.window) {
    g.window.VTTCue = VTTCue;
  }
  vttInstalled = true;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function listOf<T>(list: any): T[] {
  const out: T[] = [];
  if (!list) {
    return out;
  }
  for (let i = 0; i < (list.length || 0); i++) {
    if (list[i]) {
      out.push(list[i]);
    }
  }
  return out;
}

function describeTracks(player: any): string {
  const safe = (fn: () => any) => {
    try {
      return fn();
    } catch (e: any) {
      return `err:${e?.message || e}`;
    }
  };
  const audio = safe(() => listOf<any>(player.audioTracks).map((t) => `${t.id}:${t.language || '?'}`).join(','));
  return `tracks audio=[${audio}] video=${safe(() => player.videoTracks?.length)} text=${safe(() => player.textTracks?.length)}`;
}

function retime(cues: Cue[], subtitleFps: number | undefined, videoFps: number | undefined, log: (line: string) => void): Cue[] {
  const out = rescaleCues(cues, subtitleFps, videoFps);
  if (out !== cues) {
    log(`subtitles retimed ${subtitleFps} fps -> ${videoFps} fps`);
  }
  return out;
}

async function downloadSubtitles(sub: ExternalSubtitle, log: (line: string) => void): Promise<string> {
  if (sub.text != null) {
    return sub.text;
  }
  const urls = [sub.url, sub.fallbackUrl].filter((u): u is string => !!u);
  let lastError: any = new Error('no subtitle address');
  for (const url of urls) {
    try {
      const response = await request(url, {timeoutMs: 20000, headers: {Accept: '*/*'}});
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${hostOf(url)}`);
      }
      // A 200 can still be an HTML block or error page (e.g. an ISP content filter).
      if (!looksLikeSubtitles(response.text)) {
        throw new Error(`${hostOf(url)} did not return a subtitle file`);
      }
      return response.text;
    } catch (e: any) {
      lastError = e;
      log(`subtitle download failed (${hostOf(url)}): ${e?.message || e}`);
    }
  }
  throw lastError;
}

const LANG_3: Record<string, string> = {
  en: 'eng', es: 'spa', fr: 'fre', fra: 'fre', de: 'ger', deu: 'ger', it: 'ita', pt: 'por', nl: 'dut', nld: 'dut',
  pl: 'pol', ru: 'rus', uk: 'ukr', ar: 'ara', tr: 'tur', sv: 'swe', no: 'nor', nb: 'nor', da: 'dan', fi: 'fin',
  el: 'gre', ell: 'gre', he: 'heb', hi: 'hin', ja: 'jpn', ko: 'kor', zh: 'chi', zho: 'chi', cs: 'cze', ces: 'cze',
  hu: 'hun', ro: 'rum', ron: 'rum',
};
const LANG_NAME: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fre: 'French', ger: 'German', ita: 'Italian', por: 'Portuguese', dut: 'Dutch',
  pol: 'Polish', rus: 'Russian', ukr: 'Ukrainian', ara: 'Arabic', tur: 'Turkish', swe: 'Swedish', nor: 'Norwegian',
  dan: 'Danish', fin: 'Finnish', gre: 'Greek', heb: 'Hebrew', hin: 'Hindi', jpn: 'Japanese', kor: 'Korean',
  chi: 'Chinese', cze: 'Czech', hun: 'Hungarian', rum: 'Romanian',
};

/** Language code in one form (ISO 639-2/B), e.g. "en" and "eng" both become "eng". */
export function normaliseLang(code: string | null | undefined): string {
  const c = String(code || '').toLowerCase().split('-')[0];
  return LANG_3[c] || c;
}

function languageLabel(code: string | null | undefined): string {
  const c = normaliseLang(code);
  return LANG_NAME[c] || (c ? c.toUpperCase() : 'Original');
}

/** Scrub step for the n-th quick press in a row: 10 s, then faster. */
function scrubStep(streak: number): number {
  if (streak < 3) {
    return 10;
  }
  if (streak < 6) {
    return 30;
  }
  if (streak < 10) {
    return 60;
  }
  return 120;
}

// ---------------------------------------------------------------------------
// Small visual pieces.

const Spinner = () => {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, {toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: false}));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  return <Animated.View style={[styles.spinner, {transform: [{rotate}]}]} />;
};

const Shade = ({edge, size}: {edge: 'top' | 'bottom'; size: number}) => {
  const bands = [];
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const alpha = 0.32 * Math.pow((i + 1) / steps, 1.4);
    const h = size - (i * size) / steps;
    bands.push(
      <View key={i} pointerEvents="none" style={[styles.band, edge === 'top' ? {top: 0} : {bottom: 0}, {height: h, backgroundColor: `rgba(0,0,0,${alpha.toFixed(3)})`}]} />,
    );
  }
  return <>{bands}</>;
};

const HudButton = ({label, onPress, preferred, onFocus}: {label: string; onPress: () => void; preferred?: boolean; onFocus?: () => void}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.hudButton, focused && styles.hudButtonFocused]}>
      <Text style={[styles.hudButtonText, focused && styles.hudButtonTextFocused]}>{label}</Text>
    </TouchableOpacity>
  );
};

const PanelRow = ({label, selected, onPress, preferred}: {label: string; selected?: boolean; onPress: () => void; preferred?: boolean}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: !!selected}}
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.panelRow, focused && styles.panelRowFocused]}>
      <Text style={[styles.panelCheck, focused && styles.panelTextFocused]}>{selected ? '✓' : ''}</Text>
      <Text numberOfLines={1} style={[styles.panelText, selected && styles.panelTextSelected, focused && styles.panelTextFocused]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

// ---------------------------------------------------------------------------

export const VideoScreen = ({source, onExit, onEnded, onProgress, onLog, onZap, onFailed, onStarted, onMenu, inputLocked, chromeless, onInfo, onNext, nextLabel, preferredSubtitle, onSubtitleChosen, onRouteSwitched, onUseEngine, onTooSlow}: VideoScreenProps) => {
  const autoSubDone = useRef(false);
  const mkvRef = useRef<MkvSession | null>(null);
  const [embedded, setEmbeddedState] = useState<EmbeddedSubtitleTrack[]>([]);
  const embeddedRef = useRef<EmbeddedSubtitleTrack[]>([]);
  const setEmbedded = (tracks: EmbeddedSubtitleTrack[]) => {
    embeddedRef.current = tracks;
    setEmbeddedState(tracks);
  };
  const [, setEmbeddedVersion] = useState(0);
  const [audioLabel, setAudioLabelState] = useState('Chosen automatically');
  const audioLanguageRef = useRef('eng');
  const setAudioLabel = (label: string) => setAudioLabelState(label);
  const playerRef = useRef<VideoPlayer | null>(null);
  const adaptiveRef = useRef<AdaptiveSession | null>(null);
  const surfaceRef = useRef<string | null>(null);
  const initialisedRef = useRef(false);
  const loadedRef = useRef(false);
  const startedRef = useRef(false);
  const failedRef = useRef(false);
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const lastProgressRef = useRef(0);

  // Seeking.
  const currentUrl = useRef(source.url);
  const usingAlt = useRef(false);
  const [activeUrl, setActiveUrl] = useState(source.url);
  const onRouteSwitchedRef = useRef(onRouteSwitched);
  onRouteSwitchedRef.current = onRouteSwitched;
  const onUseEngineRef = useRef(onUseEngine);
  onUseEngineRef.current = onUseEngine;
  const onTooSlowRef = useRef(onTooSlow);
  onTooSlowRef.current = onTooSlow;
  const rebuffers = useRef<number[]>([]);
  const tooSlowSent = useRef(false);
  const startedAt = useRef(0);
  const seekTarget = useRef<number | null>(null);
  const pendingStart = useRef<number | null>(null);
  const seekCheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekAt = useRef(0);
  const protectBefore = useRef(0); // seconds; progress below this is not reported
  const resumeTarget = useRef<number | null>(null);
  const seekRetries = useRef(0);
  const seekToRef = useRef<((t: number) => void) | null>(null);
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const lastTickAt = useRef(0);
  const lastTickPos = useRef(-1);
  const scrubRef = useRef<number | null>(null);
  const scrubStreak = useRef(0);
  const lastScrubAt = useRef(0);
  const scrubCommit = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subtitles.
  const externalCues = useRef<Record<string, Cue[]>>({});
  const activeCues = useRef<Cue[] | null>(null);
  const subRequest = useRef(0);
  /** Subtitle servers that failed this session (skipped by the automatic choice). */
  const failedSubHosts = useRef(new Set<string>());
  /** The display refresh rate was switched for this film (reset on exit). */
  const displayMatched = useRef(false);
  const subShift = useRef(0); // seconds; positive shows subtitles earlier

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hud, setHud] = useState(true);
  const [area, setArea] = useState<'bar' | 'buttons'>('bar');
  const [panel, setPanel] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [subText, setSubText] = useState('');
  const [selectedSub, setSelectedSub] = useState<string>('off');
  const [shift, setShift] = useState(0);

  const log = useCallback((line: string) => onLog?.(line), [onLog]);

  const scheduleHide = useCallback((ms = 4500) => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      const player = playerRef.current;
      if (player && !player.paused && scrubRef.current == null) {
        setHud(false);
        setArea('bar');
      }
    }, ms);
  }, []);

  const showHud = useCallback(
    (ms?: number) => {
      setHud(true);
      scheduleHide(ms);
    },
    [scheduleHide],
  );

  const reportProgress = useCallback(
    (force: boolean) => {
      const player = playerRef.current;
      if (!player || !onProgress || source.live || !startedRef.current) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastProgressRef.current < 10000) {
        return;
      }
      const position = Number(player.currentTime) || 0;
      // If the resume jump was refused, keep the saved place until playback passes it.
      if (position < protectBefore.current) {
        return;
      }
      lastProgressRef.current = now;
      const d = Number(player.duration);
      onProgress(position, Number.isFinite(d) ? d : 0);
    },
    [onProgress, source.live],
  );

  const startUrl = useCallback(
    (url: string) => {
      const player = playerRef.current;
      if (!player) {
        return;
      }
      currentUrl.current = url;
      player.autoplay = true;
      player.src = url;
      try {
        const result: any = player.play();
        if (result && typeof result.catch === 'function') {
          result.catch((e: any) => log(`play() rejected: ${e?.message || e}`));
        }
      } catch (e: any) {
        log(`play() threw: ${e?.message || e}`);
      }
    },
    [log],
  );

  // Verifies a seek landed; if the platform refused it, retries via the alternative route.
  const verifySeek = useCallback(() => {
    const player = playerRef.current;
    const target = seekTarget.current;
    if (!player || target == null) {
      return;
    }
    const now = Number(player.currentTime) || 0;
    // Vega reports the requested position even when the seek failed internally, so a
    // seek only counts once playback has actually moved on from it.
    const progressed = lastTickAt.current > seekAt.current && Math.abs(now - target) <= 6;
    if (progressed) {
      seekTarget.current = null;
      seekRetries.current = 0;
      log(`seek to ${target.toFixed(1)} ok`);
      return;
    }
    seekTarget.current = null;
    log(`seek to ${target.toFixed(1)} did not resume playback (at ${now.toFixed(1)})`);
    if (source.altUrl && !usingAlt.current) {
      usingAlt.current = true;
      log('switching to the PC server route for seeking');
      setBuffering(true);
      if (onRouteSwitchedRef.current) {
        // The caller reopens playback on the alternative route at the target time
        // (a fresh player and surface: Vega cannot reload a source in place).
        onRouteSwitchedRef.current(source.url, target);
      } else {
        pendingStart.current = target;
        setActiveUrl(source.altUrl);
      }
    } else if (!source.engine && !source.live && onUseEngineRef.current) {
      // The platform player cannot jump inside this file (Matroska over the network):
      // reopen it in the in-app engine at the target (a fresh player and surface).
      log(`reopening in the engine at ${target.toFixed(1)}`);
      setBuffering(true);
      onUseEngineRef.current(target);
    } else if (seekRetries.current < 1) {
      // One more try once the pipeline has settled.
      seekRetries.current++;
      setTimeout(() => {
        log(`retrying seek to ${target.toFixed(1)}`);
        seekToRef.current?.(target);
      }, 1500);
    } else {
      seekRetries.current = 0;
      setBuffering(false);
      if (resumeTarget.current != null) {
        // Resume was refused: playback continues from the start, so protect the saved place.
        protectBefore.current = resumeTarget.current;
        resumeTarget.current = null;
        setNotice(`This version can't jump ahead, so it's playing from the start. Your place (${formatTime(protectBefore.current)}) is kept.`);
        setHud(true);
        setTimeout(() => setNotice(null), 7000);
        setPosition(now);
        return;
      }
      setNotice("Skipping isn't available for this version.");
      setTimeout(() => setNotice(null), 4000);
      setPosition(now);
    }
  }, [log, source.altUrl, source.engine, source.live, startUrl]);

  const seekTo = useCallback(
    (target: number) => {
      const player = playerRef.current;
      if (!player || source.live) {
        return;
      }
      const d = Number(player.duration);
      let t = Math.max(0, target);
      if (Number.isFinite(d) && d > 0) {
        t = Math.min(t, d - 2);
      }
      // Matroska through the in-app engine: refill from the nearest cluster (reliable).
      if (mkvRef.current) {
        setPosition(t);
        setBuffering(true);
        mkvRef.current.seek(t);
        return;
      }
      seekTarget.current = t;
      seekAt.current = Date.now();
      setPosition(t);
      setBuffering(true);
      // The platform pipeline takes a jump most reliably while paused: pause, jump, resume.
      try {
        player.pause?.();
      } catch {
        // not paused: the jump is still tried
      }
      try {
        player.currentTime = t;
      } catch (e: any) {
        log(`seek threw: ${e?.message || e}`);
      }
      setTimeout(() => {
        try {
          const p: any = player.play?.();
          p?.catch?.(() => undefined);
        } catch {
          // play() refused: the watchdog takes over
        }
      }, 400);
      if (seekCheck.current) {
        clearTimeout(seekCheck.current);
      }
      seekCheck.current = setTimeout(verifySeek, 9000);
    },
    [log, source.live, verifySeek],
  );
  seekToRef.current = seekTo;

  // Stall watchdog for films and episodes played by the platform (MP4, HLS):
  // if the clock stands still for a while during playback, re-seek to where it
  // stopped - what skipping back and forth used to fix by hand. Matroska files
  // have their own watchdog in the in-app engine.
  useEffect(() => {
    if (source.live) {
      return undefined;
    }
    let lastRecovery = 0;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player || mkvRef.current || !startedRef.current || failedRef.current || seekTarget.current != null || scrubRef.current != null) {
        return;
      }
      let paused = true;
      try {
        paused = !!player.paused;
      } catch {
        return;
      }
      const now = Date.now();
      const stalledFor = lastTickAt.current ? now - lastTickAt.current : 0;
      if (paused || stalledFor < 12000 || now - lastRecovery < 30000 || now - seekAt.current < 15000) {
        return;
      }
      lastRecovery = now;
      const t = Number(player.currentTime) || 0;
      log(`stalled for ${Math.round(stalledFor / 1000)} s at ${t.toFixed(1)}; re-seeking to recover`);
      seekToRef.current?.(Math.max(0, t - 1));
    }, 2000);
    return () => clearInterval(timer);
  }, [log, source.live, activeUrl]);

  const load = useCallback(() => {
    const player = playerRef.current;
    if (!player || !initialisedRef.current || !surfaceRef.current || loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    const kind = deliveryKind(activeUrl, source.mime);
    log(`load ${kind}: ${activeUrl}`);
    if (kind !== 'progressive') {
      // Live HLS (MPEG-TS segments) plays in the platform's own player: on the stick
      // Shaka timed out starting every live channel (18 Nov), URL mode started them all.
      const factory = kind === 'hls' && source.live ? null : adaptivePlayer();
      if (!factory && kind === 'hls' && source.live) {
        log('live HLS: platform player');
        startUrl(activeUrl);
        return;
      }
      if (factory) {
        try {
          adaptiveRef.current = factory(player, activeUrl, {live: !!source.live, autoplay: true, startAt: source.startAt});
          return;
        } catch (e: any) {
          log(`adaptive player failed: ${e?.message || e}`);
        }
      }
      log('no MSE player registered; trying URL mode (expected to fail for HLS/DASH)');
      startUrl(activeUrl);
      return;
    }
    // Films play in the platform's own player straight from the debrid server: smooth
    // picture and sound at full speed (the in-app engine repackages in JavaScript and
    // stutters on this stick). The TV's refresh rate is matched to the film first. Only a
    // resume or skip the platform player refuses (inside MKV) reopens the film in the
    // engine at that point (see verifySeek).
    const fpsFound: Promise<number | undefined> = source.live
      ? Promise.resolve(undefined)
      : source.videoFps
        ? Promise.resolve(source.videoFps)
        : detectFrameRate(activeUrl, 3000);
    const matchFrameRate = (fps: number | undefined) => {
      if (playerRef.current !== player || displayMatched.current) {
        return;
      }
      if (fps) {
        displayMatched.current = matchDisplayTo(standardRate(fps), log);
      } else {
        log('frame rate unknown: display left as it is');
      }
    };
    if (!source.engine) {
      // The display switches (a moment of black) before the picture starts, not mid-film.
      Promise.all([resolveRedirect(activeUrl), fpsFound]).then(([direct, fps]) => {
        if (playerRef.current !== player) {
          return;
        }
        // Debrid add-ons redirect to a "not ready yet" clip when the file is not cached.
        if (/\/\/slate\.|\/slate[./]|not[_-]?ready/i.test(direct) && onFailedRef.current && !failedRef.current) {
          failedRef.current = true;
          log(`start failed: placeholder clip (${hostOf(direct)}), not the film`);
          onFailedRef.current('placeholder clip (not cached)');
          return;
        }
        matchFrameRate(fps);
        const go = () => {
          if (playerRef.current === player) {
            log(`progressive: playing directly${direct !== activeUrl ? ` from ${hostOf(direct)}` : ''}`);
            startUrl(direct);
          }
        };
        // Let the TV settle on the new refresh rate before the player opens the file
        // (opening during the switch can silence the player's events).
        if (displayMatched.current) {
          setTimeout(go, 1500);
        } else {
          go();
        }
      });
      return;
    }
    fpsFound.then(matchFrameRate);
    const start = pendingStart.current;
    openMkv(
      player,
      activeUrl,
      {
        startAt: start ?? 0,
        log,
        preferredAudio: ['eng', 'en'],
        onSubtitles: () => setEmbeddedVersion((v) => v + 1),
      },
      {MediaSource: W3CMediaSource},
    )
      .then((session) => {
        if (playerRef.current !== player) {
          session?.unload();
          return;
        }
        if (!session) {
          startUrl(activeUrl);
          return;
        }
        mkvRef.current = session;
        audioLanguageRef.current = normaliseLang(session.info.audioLanguage) || 'eng';
        pendingStart.current = null; // the engine starts at the resume point itself
        setEmbedded(session.info.subtitles);
        setAudioLabel(`${languageLabel(session.info.audioLanguage)} · ${session.info.audioLabel}`);
        player.autoplay = true;
        try {
          const result: any = player.play();
          result?.catch?.((e: any) => log(`play() rejected: ${e?.message || e}`));
        } catch (e: any) {
          log(`play() threw: ${e?.message || e}`);
        }
      })
      .catch((e: any) => {
        log(`mkv engine failed (${e?.message || e}); using URL mode`);
        if (playerRef.current === player && !mkvRef.current) {
          startUrl(activeUrl);
        }
      });
  }, [log, source.live, source.mime, source.startAt, activeUrl, startUrl]);

  // Create the player once per source (and again when switching to the alternative route).
  useEffect(() => {
    installVttCue();
    const player = new VideoPlayer();
    playerRef.current = player;
    const switching = activeUrl !== source.url;
    loadedRef.current = false;
    startedRef.current = false;
    failedRef.current = false;
    currentUrl.current = activeUrl;
    lastTickAt.current = 0;
    lastTickPos.current = -1;
    if (!switching) {
      protectBefore.current = 0;
      resumeTarget.current = null;
    }
    seekTarget.current = null;
    if (!switching) {
      usingAlt.current = false;
      autoSubDone.current = false;
      pendingStart.current = source.startAt && source.startAt > 5 && !source.live ? source.startAt : null;
      externalCues.current = {};
      activeCues.current = null;
      subShift.current = 0;
      setSubText('');
      setShift(0);
      setSelectedSub('off');
      setEmbedded([]);
      setAudioLabel('Chosen automatically');
    }
    setBuffering(true);
    setError(null);
    let disposed = false;

    const fail = (reason: string) => {
      if (disposed || startedRef.current || failedRef.current || !onFailedRef.current) {
        return false;
      }
      failedRef.current = true;
      log(`start failed: ${reason}`);
      onFailedRef.current(reason);
      return true;
    };
    const watchdog = source.startTimeoutMs ? setTimeout(() => fail('timed out starting'), source.startTimeoutMs) : null;
    // Live channels: once playing, a long stall or an error hands over to the caller
    // (which switches to the next source) instead of leaving a frozen picture.
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStall = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };
    const failLive = (reason: string) => {
      if (disposed || failedRef.current || !source.live || !startedRef.current || !onFailedRef.current) {
        return false;
      }
      failedRef.current = true;
      clearStall();
      log(`live source failed: ${reason}`);
      onFailedRef.current(reason);
      return true;
    };

    const on = (name: string, fn: () => void) => player.addEventListener(name, fn as any);
    on('loadedmetadata', () => {
      log(`loadedmetadata duration=${player.duration} ${describeTracks(player)}`);
      const d = Number(player.duration);
      setDuration(Number.isFinite(d) ? d : 0);
    });
    // Playback has really started: from the 'playing' event, or (the platform does not always
    // send it) from the clock moving forward.
    const onPlaying = () => {
      clearStall();
      if (!startedRef.current) {
        let width = 0;
        let height = 0;
        try {
          width = Number((player as any).videoWidth) || 0;
          height = Number((player as any).videoHeight) || 0;
        } catch {
          // Not reported on every build.
        }
        log(`started ${width}x${height}`);
        startedAt.current = Date.now();
        onStartedRef.current?.({width, height});
      }
      startedRef.current = true;
      if (watchdog) {
        clearTimeout(watchdog);
      }
      setBuffering(false);
      setPaused(false);
      setError(null);
      // Subtitles, like a streaming service: the remembered language, preferring the
      // file's own track (perfectly in sync); with subtitles off, still show "forced"
      // subtitles (foreign-language lines) in the audio language.
      if (!autoSubDone.current) {
        autoSubDone.current = true;
        const pref = normaliseLang(preferredSubtitle);
        const embeddedTracks = embeddedRef.current;
        const builtIn = pref ? embeddedTracks.find((t) => !t.forced && normaliseLang(t.language) === pref) : undefined;
        const external = pref ? (source.subtitles || []).find((s) => normaliseLang(s.language) === pref) : undefined;
        const forced = !pref ? embeddedTracks.find((t) => t.forced && normaliseLang(t.language) === normaliseLang(audioLanguageRef.current || 'eng')) : undefined;
        if (builtIn) {
          log(`auto subtitles: built-in ${builtIn.language}`);
          chooseEmbedded(builtIn, false);
        } else if (external) {
          log(`auto subtitles: ${external.label}`);
          chooseSubtitle(external, false);
        } else if (forced) {
          log(`auto subtitles: forced ${forced.language}`);
          chooseEmbedded(forced, false);
        }
      }
      // Resume (or continue a seek after switching route) once playback is really running.
      // Vega refuses seeks issued the moment playback starts, so wait until it is steady.
      const start = pendingStart.current;
      if (start != null) {
        pendingStart.current = null;
        setResumeNote(`Resuming from ${formatTime(start)}…`);
        setTimeout(() => {
          if (!disposed) {
            log(`resuming at ${start.toFixed(1)}`);
            resumeTarget.current = start;
            seekTo(start);
            setResumeNote(null);
          }
        }, 2500);
      }
    };
    on('playing', onPlaying);
    on('pause', () => {
      setPaused(true);
      setHud(true);
      reportProgress(true);
    });
    on('waiting', () => {
      setBuffering(true);
      // A film that keeps rebuffering is heavier than this connection carries: hand over
      // (the caller picks a version that fits and continues from the same place).
      if (!source.live && startedRef.current && !tooSlowSent.current && Date.now() - seekAt.current > 6000 && Date.now() - startedAt.current > 8000) {
        const now = Date.now();
        rebuffers.current = rebuffers.current.filter((at) => now - at < 60000).concat(now);
        if (rebuffers.current.length >= 2 && onTooSlowRef.current) {
          tooSlowSent.current = true;
          const at = Number(player.currentTime) || 0;
          log(`rebuffered ${rebuffers.current.length} times in a minute at ${at.toFixed(1)}: switching to a version that fits the connection`);
          onTooSlowRef.current(at);
        }
      }
      if (source.live && startedRef.current && !stallTimer) {
        stallTimer = setTimeout(() => failLive('stalled for 15 s'), 15000);
      }
    });
    on('seeking', () => setBuffering(true));
    on('seeked', () => {
      setBuffering(false);
      if (seekCheck.current) {
        clearTimeout(seekCheck.current);
      }
      // A jump inside a remote 4K file can take several seconds to really land.
      seekCheck.current = setTimeout(verifySeek, mkvRef.current ? 2000 : 8000);
    });
    let lastTimeEvent = 0;
    const onTime = (fromEvent: boolean) => {
      if (fromEvent) {
        lastTimeEvent = Date.now();
      }
      const t = Number(player.currentTime) || 0;
      const moved = Math.abs(t - lastTickPos.current) > 0.05;
      // A tick counts as progress only when the clock actually moved.
      if (Math.abs(t - lastTickPos.current) > 0.05) {
        lastTickAt.current = Date.now();
        lastTickPos.current = t;
        clearStall();
      }
      if (!startedRef.current && t > 0.3 && lastTickAt.current > 0 && !player.paused) {
        onPlaying();
      }
      if (scrubRef.current == null) {
        setPosition(Number(player.currentTime) || 0);
      }
      const d = Number(player.duration);
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
      }
      if (!moved && !fromEvent) {
        return; // polled and the clock has not moved: nothing new
      }
      setBuffering(false);
      reportProgress(false);
    };
    on('timeupdate', () => onTime(true));
    // The platform does not always send events (e.g. after a display mode change): if they
    // go quiet, read the clock directly so start, position and progress still work.
    const clockPoll = setInterval(() => {
      if (!disposed && Date.now() - lastTimeEvent > 1500) {
        try {
          if (!player.paused) {
            onTime(false);
          }
        } catch {
          // player gone
        }
      }
    }, 1000);
    on('ended', () => {
      reportProgress(true);
      if (onNext) {
        onNext();
      } else {
        onEnded?.();
      }
    });
    on('error', () => {
      const err: any = player.error;
      const code = err ? Number(err.code) : 0;
      log(`error code=${code} message=${err?.message}`);
      const message = MEDIA_ERRORS[code] || 'This video could not be played.';
      if (fail(err?.message || message) || failLive(err?.message || message)) {
        return;
      }
      setError(message);
      setBuffering(false);
      setHud(true);
    });

    player
      .initialize()
      .then(() => {
        if (disposed) {
          return;
        }
        initialisedRef.current = true;
        log('player initialised');
        if (surfaceRef.current) {
          player.setSurfaceHandle(surfaceRef.current);
        }
        load();
      })
      .catch((e: any) => {
        log(`initialize failed: ${e?.message || e}`);
        setError('The video player could not start.');
      });

    scheduleHide(5000);

    return () => {
      disposed = true;
      clearInterval(clockPoll);
      mkvRef.current?.unload();
      mkvRef.current = null;
      if (watchdog) {
        clearTimeout(watchdog);
      }
      clearStall();
      [hideTimer.current, seekCheck.current, scrubCommit.current].forEach((t) => t && clearTimeout(t));
      reportProgress(true);
      try {
        player.pause();
      } catch {
        // Already stopped.
      }
      const session = adaptiveRef.current;
      adaptiveRef.current = null;
      Promise.resolve(session?.unload())
        .catch(() => undefined)
        .then(() => {
          if (surfaceRef.current) {
            try {
              player.clearSurfaceHandle(surfaceRef.current);
            } catch {
              // Surface already gone.
            }
          }
          return player.deinitialize();
        })
        .catch(() => undefined);
      initialisedRef.current = false;
      playerRef.current = null;
      if (displayMatched.current) {
        displayMatched.current = false;
        resetDisplay(log);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl]);

  const onSurfaceViewCreated = (handle: string) => {
    surfaceRef.current = handle;
    const player = playerRef.current;
    if (player && initialisedRef.current) {
      player.setSurfaceHandle(handle);
      load();
    }
  };

  const onSurfaceViewDestroyed = (handle: string) => {
    const player = playerRef.current;
    if (player) {
      try {
        player.clearSurfaceHandle(handle);
      } catch {
        // Ignore.
      }
    }
    surfaceRef.current = null;
  };

  const onCaptionViewCreated = (handle: string) => {
    const player: any = playerRef.current;
    if (player && typeof player.setCaptionViewHandle === 'function') {
      player.setCaptionViewHandle(handle);
    }
  };

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (player.paused) {
      player.play();
      scheduleHide();
    } else {
      player.pause();
    }
    setHud(true);
  };

  // ◀ ▶ move a preview position; the jump happens shortly after the last press (or on OK).
  const commitScrub = useCallback(() => {
    if (scrubCommit.current) {
      clearTimeout(scrubCommit.current);
      scrubCommit.current = null;
    }
    const target = scrubRef.current;
    scrubRef.current = null;
    setScrub(null);
    scrubStreak.current = 0;
    if (target != null) {
      seekTo(target);
    }
    scheduleHide();
  }, [scheduleHide, seekTo]);

  const scrubBy = (direction: 1 | -1, fixedStep?: number) => {
    const player = playerRef.current;
    if (!player || source.live) {
      return;
    }
    const now = Date.now();
    scrubStreak.current = now - lastScrubAt.current < 700 ? scrubStreak.current + 1 : 0;
    lastScrubAt.current = now;
    const base = scrubRef.current ?? (Number(player.currentTime) || 0);
    const d = Number(player.duration);
    let next = base + direction * (fixedStep ?? scrubStep(scrubStreak.current));
    next = Math.max(0, Number.isFinite(d) && d > 0 ? Math.min(next, d - 2) : next);
    scrubRef.current = next;
    setScrub(next);
    setHud(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    if (scrubCommit.current) {
      clearTimeout(scrubCommit.current);
    }
    scrubCommit.current = setTimeout(commitScrub, 900);
  };

  // Subtitles: draw the active cue ten times a second.
  useEffect(() => {
    const timer = setInterval(() => {
      const cues = activeCues.current;
      const player: any = playerRef.current;
      if (!cues || !player) {
        return;
      }
      const text = cueTextAt(cues, (Number(player.currentTime) || 0) + subShift.current);
      setSubText((previous) => (previous === text ? previous : text));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  /** Shows one of the file's own subtitle tracks (cues keep arriving as the file is read). */
  const chooseEmbedded = (track: EmbeddedSubtitleTrack, byViewer = true) => {
    clearSubtitle();
    if (byViewer) {
      onSubtitleChosen?.(track.forced ? null : normaliseLang(track.language));
    }
    setSelectedSub(`emb-${track.number}`);
    activeCues.current = track.cues;
  };

  const clearSubtitle = () => {
    subRequest.current++;
    activeCues.current = null;
    setSubText('');
  };

  const chooseSubtitle = async (sub: ExternalSubtitle | null, byViewer = true): Promise<void> => {
    const player: any = playerRef.current;
    for (const track of listOf<any>(player?.textTracks)) {
      track.mode = 'disabled';
    }
    clearSubtitle();
    if (byViewer) {
      onSubtitleChosen?.(sub ? sub.language || null : null);
    }
    if (!sub) {
      setSelectedSub('off');
      return;
    }
    const token = subRequest.current;
    setSelectedSub(sub.id);
    let cues = externalCues.current[sub.id];
    if (!cues) {
      try {
        cues = parseSubtitles(await downloadSubtitles(sub, log));
        if (!cues.length) {
          throw new Error('no cues found');
        }
        cues = retime(cues, sub.fps, source.videoFps, log);
        externalCues.current[sub.id] = cues;
        log(`subtitles ${sub.label}: ${cues.length} cues`);
      } catch (e: any) {
        if (token === subRequest.current) {
          log(`subtitles failed: ${e?.message || e}`);
          if (!byViewer && playerRef.current === player) {
            // Automatic choice: the next subtitle in the same language from a server that has
            // not just failed (a blocked mirror fails for every file it holds).
            failedSubHosts.current.add(hostOf(sub.fallbackUrl || sub.url));
            const list = source.subtitles || [];
            const next = list
              .slice(list.findIndex((s) => s.id === sub.id) + 1)
              .find((s) => s.language === sub.language && !failedSubHosts.current.has(hostOf(s.fallbackUrl || s.url)));
            if (next) {
              log(`auto subtitles: trying ${next.label}`);
              return chooseSubtitle(next, false);
            }
          }
          setSelectedSub('off');
          setNotice("Those subtitles couldn't be loaded. Try another.");
          setTimeout(() => setNotice(null), 4000);
        }
        return;
      }
    }
    if (token === subRequest.current) {
      activeCues.current = cues;
    }
  };

  const nudgeSubtitles = (delta: number) => {
    subShift.current = Math.round((subShift.current + delta) * 100) / 100;
    setShift(subShift.current);
    log(`subtitle shift ${subShift.current}s`);
  };

  const openPanel = () => {
    if (scrubRef.current != null) {
      commitScrub();
    }
    setPanel(true);
    setHud(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    log(`subtitles panel opened: ${describeTracks(playerRef.current)}`);
  };

  const closePanel = () => {
    setPanel(false);
    setArea('bar');
    scheduleHide();
  };

  useRemoteKeys((key: RemoteKey) => {
    if (panel) {
      return; // The side panel uses normal focus navigation.
    }
    if (area === 'buttons') {
      if (key === 'up') {
        setArea('bar');
        scheduleHide();
      } else if (key === 'playpause') {
        togglePlay();
      } else {
        scheduleHide(8000); // Focus moves between buttons natively.
      }
      return;
    }
    switch (key) {
      case 'select':
        if (onInfo) {
          onInfo();
        } else if (scrubRef.current != null) {
          commitScrub();
        } else if (!hud) {
          showHud();
        } else {
          togglePlay();
        }
        break;
      case 'playpause':
      case 'play':
      case 'pause':
        if (scrubRef.current != null) {
          commitScrub();
        }
        togglePlay();
        break;
      case 'left':
        scrubBy(-1);
        break;
      case 'right':
        scrubBy(1);
        break;
      case 'skip_backward':
        scrubBy(-1, 30);
        break;
      case 'skip_forward':
        scrubBy(1, 30);
        break;
      case 'channel_up':
        onZap?.(1);
        break;
      case 'channel_down':
        onZap?.(-1);
        break;
      case 'up':
        if (onZap) {
          onZap(-1);
        } else {
          showHud();
        }
        break;
      case 'down':
        if (onZap) {
          onZap(1);
        } else if (hud) {
          setArea('buttons');
          scheduleHide(8000);
        } else {
          showHud();
        }
        break;
      case 'menu':
      case 'context_menu':
        if (onMenu) {
          onMenu();
        } else {
          openPanel();
        }
        break;
      default:
        break;
    }
  }, !inputLocked);

  useBackHandler(() => {
    if (panel) {
      closePanel();
      return true;
    }
    if (scrubRef.current != null) {
      scrubRef.current = null;
      setScrub(null);
      return true;
    }
    if (area === 'buttons') {
      setArea('bar');
      return true;
    }
    if (hud && !paused && !error) {
      setHud(false);
      return true;
    }
    reportProgress(true);
    onExit();
    return true;
  }, !inputLocked);

  const shown = scrub ?? position;
  const progress = duration > 0 ? Math.min(1, shown / duration) : 0;
  const remaining = Math.max(0, duration - shown);
  const subs = source.subtitles || [];
  const subtitleLabel = selectedSub === 'off' ? 'Subtitles' : 'Subtitles · On';

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView style={styles.surface} onSurfaceViewCreated={onSurfaceViewCreated} onSurfaceViewDestroyed={onSurfaceViewDestroyed} />
      <KeplerCaptionsView onCaptionViewCreated={onCaptionViewCreated} show={true} style={styles.captions} />

      {subText ? (
        <View style={[styles.subtitleBox, hud && !panel ? styles.subtitleRaised : null]} pointerEvents="none">
          <Text style={styles.subtitleText}>{subText}</Text>
        </View>
      ) : null}

      {(buffering || scrub != null || resumeNote) && !error && !panel && !(chromeless && !startedRef.current) ? (
        <View style={styles.centre} pointerEvents="none">
          {buffering && scrub == null ? <Spinner /> : null}
          {resumeNote ? <Text style={styles.centreNote}>{resumeNote}</Text> : null}
        </View>
      ) : null}

      {(hud || error) && !chromeless ? (
        <>
          <View style={styles.topArea} pointerEvents="none">
            <Shade edge="top" size={260} />
            <Text style={styles.title} numberOfLines={1}>
              {source.title}
            </Text>
            {source.subtitle ? (
              <Text style={styles.subtitleLine} numberOfLines={1}>
                {source.subtitle}
              </Text>
            ) : null}
          </View>

          <View style={styles.bottomArea}>
            <Shade edge="bottom" size={360} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            {!source.live ? (
              <View style={styles.timeline}>
                <View style={styles.track}>
                  <View style={[styles.fill, {width: `${progress * 100}%`}]} />
                  <View style={[styles.thumb, scrub != null && styles.thumbActive, {left: `${progress * 100}%`}]} />
                  {scrub != null ? (
                    <View style={[styles.bubble, {left: `${progress * 100}%`}]}>
                      <Text style={styles.bubbleText}>{formatTime(scrub)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.remaining}>{duration > 0 ? formatTime(remaining) : ''}</Text>
              </View>
            ) : (
              <Text style={styles.live}>● LIVE</Text>
            )}
            <View style={styles.buttons}>
              {area === 'buttons' ? (
                <>
                  <HudButton label={paused ? 'Play' : 'Pause'} preferred onPress={togglePlay} />
                  <HudButton label={subtitleLabel} onPress={openPanel} />
                  {onNext ? <HudButton label={nextLabel || 'Next Episode'} onPress={onNext} /> : null}
                  {error ? <HudButton label="Back" onPress={onExit} /> : null}
                </>
              ) : (
                <>
                  <Text style={styles.buttonHint}>{paused ? '▶ Paused' : ''}</Text>
                  <Text style={styles.buttonHintMuted}>▼ {subtitleLabel}{onNext ? `   ${nextLabel || 'Next Episode'}` : ''}</Text>
                </>
              )}
              <View style={styles.flex} />
              {source.detail ? <Text style={styles.quality}>{source.detail}</Text> : null}
            </View>
          </View>
        </>
      ) : null}

      {panel ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Audio</Text>
          <Text style={styles.panelNote}>{audioLabel}</Text>
          <Text style={[styles.panelTitle, styles.panelGap]}>Subtitles</Text>
          <ScrollView style={styles.panelList}>
            <PanelRow label="Off" selected={selectedSub === 'off'} preferred onPress={() => chooseSubtitle(null).then(closePanel)} />
            {/* The file's own tracks first: always in sync with this exact video. */}
            {[...embedded]
              .sort((a, b) => Number(normaliseLang(b.language) === 'eng') - Number(normaliseLang(a.language) === 'eng') || Number(a.forced) - Number(b.forced))
              .map((track) => (
                <PanelRow
                  key={`emb-${track.number}`}
                  label={`${languageLabel(track.language)}${track.forced ? ' (forced)' : ''}${track.name && !/^(sdh|full|forced)$/i.test(track.name) ? ` · ${track.name}` : ''}`}
                  selected={selectedSub === `emb-${track.number}`}
                  onPress={() => {
                    chooseEmbedded(track);
                    closePanel();
                  }}
                />
              ))}
            {subs.map((sub) => (
              <PanelRow key={sub.id} label={sub.label} selected={selectedSub === sub.id} onPress={() => chooseSubtitle(sub).then(closePanel)} />
            ))}
            {subs.length === 0 && embedded.length === 0 ? <Text style={styles.panelNote}>No subtitles found for this title.</Text> : null}
          </ScrollView>
          {selectedSub !== 'off' ? (
            <View style={styles.timing}>
              <Text style={styles.panelNote}>Timing {shift === 0 ? 'unchanged' : `${Math.abs(shift).toFixed(2)} s ${shift > 0 ? 'earlier' : 'later'}`}</Text>
              <View style={styles.timingRow}>
                <HudButton label="Show earlier" onPress={() => nudgeSubtitles(0.25)} />
                <HudButton label="Show later" onPress={() => nudgeSubtitles(-0.25)} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: 'black'},
  flex: {flex: 1},
  surface: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  captions: {position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'transparent', zIndex: 2},
  band: {position: 'absolute', left: 0, right: 0},

  subtitleBox: {position: 'absolute', left: 160, right: 160, bottom: 86, alignItems: 'center', zIndex: 3},
  subtitleRaised: {bottom: 300},
  subtitleText: {
    color: '#ffffff',
    fontSize: 50,
    lineHeight: 62,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: {width: 0, height: 2},
    textShadowRadius: 8,
  },

  centre: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 3},
  spinner: {width: 96, height: 96, borderRadius: 48, borderWidth: 7, borderColor: 'rgba(255,255,255,0.18)', borderTopColor: ACCENT},
  centreNote: {color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 24, textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 6},

  topArea: {position: 'absolute', top: 0, left: 0, right: 0, height: 260, paddingHorizontal: 90, paddingTop: 60, zIndex: 4},
  title: {color: '#fff', fontSize: 40, fontWeight: '800'},
  subtitleLine: {color: 'rgba(255,255,255,0.75)', fontSize: 26, marginTop: 6},

  bottomArea: {position: 'absolute', left: 0, right: 0, bottom: 0, height: 360, justifyContent: 'flex-end', paddingHorizontal: 90, paddingBottom: 56, zIndex: 4},
  error: {color: '#fff', fontSize: 30, fontWeight: '700', marginBottom: 18},
  notice: {color: 'rgba(255,255,255,0.85)', fontSize: 24, marginBottom: 18},
  timeline: {flexDirection: 'row', alignItems: 'center'},
  track: {flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.28)'},
  fill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: ACCENT},
  thumb: {position: 'absolute', top: -8, width: 24, height: 24, marginLeft: -12, borderRadius: 12, backgroundColor: ACCENT},
  thumbActive: {top: -12, width: 32, height: 32, marginLeft: -16, borderRadius: 16, backgroundColor: '#fff'},
  bubble: {position: 'absolute', bottom: 34, width: 160, marginLeft: -80, alignItems: 'center'},
  bubbleText: {color: '#fff', fontSize: 30, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 6},
  remaining: {color: '#fff', fontSize: 26, fontWeight: '600', width: 150, textAlign: 'right'},
  live: {color: '#ff5c5c', fontSize: 26, fontWeight: '800'},
  buttons: {flexDirection: 'row', alignItems: 'center', marginTop: 26, height: 64},
  buttonHint: {color: '#fff', fontSize: 24, fontWeight: '700', marginRight: 26},
  buttonHintMuted: {color: 'rgba(255,255,255,0.6)', fontSize: 22},
  quality: {color: 'rgba(255,255,255,0.7)', fontSize: 22, fontWeight: '600'},
  hudButton: {paddingHorizontal: 26, paddingVertical: 12, borderRadius: 8, marginRight: 14, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 3, borderColor: 'transparent'},
  hudButtonFocused: {backgroundColor: '#fff'},
  hudButtonText: {color: '#fff', fontSize: 24, fontWeight: '700'},
  hudButtonTextFocused: {color: '#000'},

  panel: {position: 'absolute', top: 0, right: 0, bottom: 0, width: 620, backgroundColor: 'rgba(12,12,16,0.94)', paddingHorizontal: 50, paddingTop: 70, paddingBottom: 40, zIndex: 6},
  panelTitle: {color: '#fff', fontSize: 34, fontWeight: '800'},
  panelGap: {marginTop: 34, marginBottom: 10},
  panelNote: {color: 'rgba(255,255,255,0.6)', fontSize: 22, marginTop: 6},
  panelList: {flex: 1},
  panelRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8},
  panelRowFocused: {backgroundColor: '#fff'},
  panelCheck: {color: '#fff', fontSize: 26, width: 40, fontWeight: '800'},
  panelText: {color: 'rgba(255,255,255,0.72)', fontSize: 26, flex: 1},
  panelTextSelected: {color: '#fff', fontWeight: '800'},
  panelTextFocused: {color: '#000'},
  timing: {marginTop: 16},
  timingRow: {flexDirection: 'row', marginTop: 12},
});
