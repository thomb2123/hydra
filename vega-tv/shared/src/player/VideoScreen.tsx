// Full-screen player built on Vega's W3C media API.
//
// - Progressive files (MP4, MKV, WebM, MPEG-TS, AVI, MOV, FLV) play in URL mode,
//   decoded by the platform's GStreamer pipeline with hardware video decoding.
// - HLS/DASH need MSE mode and a JS player registered in ./adaptive.
// - External SRT/VTT subtitles are fetched, parsed in JS and added as VTTCues.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  KeplerCaptionsView,
  KeplerVideoSurfaceView,
  VideoPlayer,
  VTTCue,
} from '@amazon-devices/react-native-w3cmedia';
import {RemoteKey, useBackHandler, useRemoteKeys} from '../tv/remote';
import {FocusButton} from '../ui/FocusButton';
import {colors, fonts, spacing} from '../ui/theme';
import {AdaptiveSession, adaptivePlayer, deliveryKind} from './adaptive';
import {parseSubtitles} from '../subtitles';
import {request} from '../net';

export interface ExternalSubtitle {
  id: string;
  label: string;
  language?: string;
  url: string;
  /** Inline subtitle text; skips the download when present. */
  text?: string;
}

export interface PlaySource {
  url: string;
  title: string;
  mime?: string;
  live?: boolean;
  startAt?: number;
  subtitles?: ExternalSubtitle[];
  /** Shown under the title, e.g. "Episode 3" or the stream name. */
  detail?: string;
}

export interface VideoScreenProps {
  source: PlaySource;
  onExit: () => void;
  onEnded?: () => void;
  /** Called about every 10 s and on exit with the position in seconds. */
  onProgress?: (position: number, duration: number) => void;
  /** Lets a caller log diagnostics (the proof-of-concept app shows them on screen). */
  onLog?: (line: string) => void;
  /**
   * Live TV zapping: when set, ▲/▼ and Channel +/- switch channel (step +1/-1)
   * and the Menu (☰) key opens the audio/subtitle menu instead.
   */
  onZap?: (step: number) => void;
}

type MenuEntry = {key: string; label: string; selected: boolean; apply: () => void};

const MEDIA_ERRORS: Record<number, string> = {
  1: 'Playback was aborted.',
  2: 'A network error stopped the download of the media.',
  3: 'The media could not be decoded (codec or corrupt data).',
  4: 'This format or address is not supported by the Vega player.',
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

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
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

export const VideoScreen = ({source, onExit, onEnded, onProgress, onLog, onZap}: VideoScreenProps) => {
  const playerRef = useRef<VideoPlayer | null>(null);
  const adaptiveRef = useRef<AdaptiveSession | null>(null);
  const surfaceRef = useRef<string | null>(null);
  const initialisedRef = useRef(false);
  const loadedRef = useRef(false);
  const lastProgressRef = useRef(0);
  const externalTracks = useRef<Record<string, any>>({});
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState('Starting player…');
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [osdVisible, setOsdVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuEntries, setMenuEntries] = useState<MenuEntry[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>('off');

  const log = useCallback(
    (line: string) => {
      onLog?.(line);
    },
    [onLog],
  );

  const showOsd = useCallback(() => {
    setOsdVisible(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      const player = playerRef.current;
      if (player && !player.paused) {
        setOsdVisible(false);
      }
    }, 5000);
  }, []);

  const reportProgress = useCallback(
    (force: boolean) => {
      const player = playerRef.current;
      if (!player || !onProgress || source.live) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastProgressRef.current < 10000) {
        return;
      }
      lastProgressRef.current = now;
      const d = Number(player.duration);
      onProgress(Number(player.currentTime) || 0, Number.isFinite(d) ? d : 0);
    },
    [onProgress, source.live],
  );

  const load = useCallback(() => {
    const player = playerRef.current;
    if (!player || !initialisedRef.current || !surfaceRef.current || loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    const kind = deliveryKind(source.url, source.mime);
    log(`load ${kind}: ${source.url}`);
    if (kind !== 'progressive') {
      const factory = adaptivePlayer();
      if (factory) {
        try {
          adaptiveRef.current = factory(player, source.url, {live: !!source.live, autoplay: true, startAt: source.startAt});
          setStatus('Loading stream…');
          return;
        } catch (e: any) {
          log(`adaptive player failed: ${e?.message || e}`);
        }
      }
      log('no MSE player registered; trying URL mode (expected to fail for HLS/DASH)');
    }
    player.autoplay = true;
    player.src = source.url;
    try {
      const result: any = player.play();
      if (result && typeof result.catch === 'function') {
        result.catch((e: any) => log(`play() rejected: ${e?.message || e}`));
      }
    } catch (e: any) {
      log(`play() threw: ${e?.message || e}`);
    }
    setStatus('Loading…');
  }, [log, source.live, source.mime, source.startAt, source.url]);

  // Create the player once per source.
  useEffect(() => {
    installVttCue();
    const player = new VideoPlayer();
    playerRef.current = player;
    loadedRef.current = false;
    externalTracks.current = {};
    let disposed = false;

    const on = (name: string, fn: () => void) => player.addEventListener(name, fn as any);
    on('loadedmetadata', () => {
      log(`loadedmetadata duration=${player.duration} size=${player.videoWidth}x${player.videoHeight}`);
      const d = Number(player.duration);
      setDuration(Number.isFinite(d) ? d : 0);
      if (source.startAt && source.startAt > 5 && !source.live) {
        try {
          player.currentTime = source.startAt;
        } catch (e: any) {
          log(`resume seek failed: ${e?.message || e}`);
        }
      }
    });
    on('playing', () => {
      setStatus('Playing');
      setPaused(false);
      setError(null);
      showOsd();
    });
    on('pause', () => {
      setStatus('Paused');
      setPaused(true);
      setOsdVisible(true);
      reportProgress(true);
    });
    on('waiting', () => setStatus('Buffering…'));
    on('seeking', () => setStatus('Seeking…'));
    on('timeupdate', () => {
      setPosition(Number(player.currentTime) || 0);
      const d = Number(player.duration);
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
      }
      reportProgress(false);
    });
    on('ended', () => {
      setStatus('Finished');
      reportProgress(true);
      onEnded?.();
    });
    on('error', () => {
      const err: any = player.error;
      const code = err ? Number(err.code) : 0;
      const kind = deliveryKind(source.url, source.mime);
      let message = (err && err.message) || MEDIA_ERRORS[code] || 'Playback failed.';
      if (kind !== 'progressive' && !adaptivePlayer()) {
        message += ' HLS/DASH streams need the Vega Shaka build, which this package does not include yet.';
      }
      log(`error code=${code} message=${err?.message}`);
      setError(message);
      setStatus('Error');
      setOsdVisible(true);
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
        setError(`The media player could not start (${e?.message || e}). Check the manifest media services.`);
      });

    return () => {
      disposed = true;
      reportProgress(true);
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url]);

  const onSurfaceViewCreated = (handle: string) => {
    surfaceRef.current = handle;
    log('surface created');
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
    } else {
      player.pause();
    }
    showOsd();
  };

  const seekBy = (delta: number) => {
    const player = playerRef.current;
    if (!player || source.live) {
      showOsd();
      return;
    }
    const d = Number(player.duration);
    let target = (Number(player.currentTime) || 0) + delta;
    if (Number.isFinite(d) && d > 0) {
      target = Math.min(target, d - 1);
    }
    target = Math.max(0, target);
    player.currentTime = target;
    setPosition(target);
    showOsd();
  };

  const selectExternalSubtitle = async (sub: ExternalSubtitle) => {
    const player: any = playerRef.current;
    if (!player) {
      return;
    }
    for (const track of listOf<any>(player.textTracks)) {
      track.mode = 'disabled';
    }
    let track = externalTracks.current[sub.id];
    if (!track) {
      setStatus(`Loading subtitles: ${sub.label}`);
      try {
        let body = sub.text;
        if (body == null) {
          const response = await request(sub.url, {timeoutMs: 20000, headers: {Accept: '*/*'}});
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          body = response.text;
        }
        const cues = parseSubtitles(body);
        if (!cues.length) {
          throw new Error('no cues found');
        }
        track = player.addTextTrack('subtitles', sub.label, sub.language || '');
        for (const cue of cues) {
          track.addCue(new VTTCue(cue.start, cue.end, cue.text));
        }
        externalTracks.current[sub.id] = track;
        log(`subtitles ${sub.label}: ${cues.length} cues`);
      } catch (e: any) {
        log(`subtitles failed: ${e?.message || e}`);
        setStatus(`Subtitles unavailable (${e?.message || e})`);
        return;
      }
    }
    track.mode = 'showing';
    setSelectedSub(sub.id);
    setStatus(player.paused ? 'Paused' : 'Playing');
  };

  const buildMenu = (): MenuEntry[] => {
    const player: any = playerRef.current;
    if (!player) {
      return [];
    }
    const entries: MenuEntry[] = [];
    const audio = listOf<any>(player.audioTracks);
    audio.forEach((track, index) => {
      entries.push({
        key: `a-${track.id || index}`,
        label: `Audio: ${track.label || track.language || `Track ${index + 1}`}`,
        selected: !!track.enabled,
        apply: () => {
          audio.forEach((other) => {
            other.enabled = other === track;
          });
          log(`audio -> ${track.label || track.language || index}`);
        },
      });
    });
    entries.push({
      key: 's-off',
      label: 'Subtitles: Off',
      selected: selectedSub === 'off',
      apply: () => {
        for (const t of listOf<any>(player.textTracks)) {
          t.mode = 'disabled';
        }
        setSelectedSub('off');
      },
    });
    const external = new Set(Object.values(externalTracks.current));
    listOf<any>(player.textTracks)
      .filter((t) => !external.has(t))
      .forEach((track, index) => {
        const id = `native-${track.id || index}`;
        entries.push({
          key: id,
          label: `Subtitles: ${track.label || track.language || `Embedded ${index + 1}`}`,
          selected: selectedSub === id,
          apply: () => {
            for (const t of listOf<any>(player.textTracks)) {
              t.mode = t === track ? 'showing' : 'disabled';
            }
            setSelectedSub(id);
          },
        });
      });
    (source.subtitles || []).forEach((sub) => {
      entries.push({
        key: `x-${sub.id}`,
        label: `Subtitles: ${sub.label}`,
        selected: selectedSub === sub.id,
        apply: () => {
          selectExternalSubtitle(sub);
        },
      });
    });
    return entries;
  };

  const openMenu = () => {
    setMenuEntries(buildMenu());
    setMenuOpen(true);
    setOsdVisible(true);
  };

  useRemoteKeys((key: RemoteKey) => {
    switch (key) {
      case 'select':
      case 'playpause':
        togglePlay();
        break;
      case 'play':
        playerRef.current?.play();
        showOsd();
        break;
      case 'pause':
        playerRef.current?.pause();
        break;
      case 'left':
        seekBy(-10);
        break;
      case 'right':
        seekBy(10);
        break;
      case 'skip_backward':
        seekBy(-30);
        break;
      case 'skip_forward':
        seekBy(30);
        break;
      case 'channel_up':
        if (onZap) {
          onZap(1);
        }
        break;
      case 'channel_down':
        if (onZap) {
          onZap(-1);
        }
        break;
      case 'up':
      case 'down':
        if (onZap) {
          onZap(key === 'up' ? -1 : 1);
        } else {
          openMenu();
        }
        break;
      case 'menu':
      case 'context_menu':
        openMenu();
        break;
      default:
        break;
    }
  }, !menuOpen);

  useBackHandler(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return true;
    }
    reportProgress(true);
    onExit();
    return true;
  });

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView
        style={styles.surface}
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
      />
      <KeplerCaptionsView onCaptionViewCreated={onCaptionViewCreated} show={true} style={styles.captions} />

      {osdVisible || error ? (
        <View style={styles.osd} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>
            {source.title}
          </Text>
          {source.detail ? (
            <Text style={styles.detail} numberOfLines={1}>
              {source.detail}
            </Text>
          ) : null}
          <Text style={[styles.status, error ? styles.errorText : null]}>{error || status}</Text>
          {!source.live ? (
            <View style={styles.timeline}>
              <Text style={styles.time}>{formatTime(position)}</Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, {width: `${progress * 100}%`}]} />
              </View>
              <Text style={styles.time}>{formatTime(duration)}</Text>
            </View>
          ) : (
            <Text style={styles.live}>● LIVE</Text>
          )}
          <Text style={styles.hint}>
            {onZap
              ? `${paused ? 'OK: play' : 'OK: pause'} · ▲▼ change channel · ☰ audio & subtitles · Back: close`
              : `${paused ? 'OK: play' : 'OK: pause'} · ◀ ▶ 10 s · ⏪ ⏩ 30 s · ▲▼ audio & subtitles · Back: close`}
          </Text>
        </View>
      ) : null}

      {menuOpen ? (
        <View style={styles.menu}>
          <Text style={styles.menuTitle}>Audio & subtitles</Text>
          <ScrollView>
            {menuEntries.length === 0 ? <Text style={styles.detail}>No tracks reported yet.</Text> : null}
            {menuEntries.map((entry, index) => (
              <FocusButton
                key={entry.key}
                label={entry.label}
                selected={entry.selected}
                compact
                hasTVPreferredFocus={index === 0}
                onPress={() => {
                  entry.apply();
                  setMenuOpen(false);
                  showOsd();
                }}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: 'black'},
  surface: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  captions: {position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'transparent', zIndex: 2},
  osd: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 80,
    paddingTop: spacing.l,
    paddingBottom: 48,
    backgroundColor: 'rgba(0,0,0,0.72)',
    zIndex: 3,
  },
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '700'},
  detail: {color: colors.textMuted, fontSize: fonts.body, marginTop: 4},
  status: {color: colors.text, fontSize: fonts.body, marginTop: spacing.s},
  errorText: {color: colors.danger},
  timeline: {flexDirection: 'row', alignItems: 'center', marginTop: spacing.m},
  time: {color: colors.text, fontSize: fonts.small, width: 120, textAlign: 'center'},
  bar: {flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 4, overflow: 'hidden'},
  barFill: {height: 8, backgroundColor: colors.focus},
  live: {color: colors.danger, fontSize: fonts.body, marginTop: spacing.m, fontWeight: '700'},
  hint: {color: colors.textMuted, fontSize: 20, marginTop: spacing.m},
  menu: {
    position: 'absolute',
    top: 60,
    right: 60,
    bottom: 60,
    width: 640,
    backgroundColor: 'rgba(16,19,24,0.96)',
    borderRadius: 18,
    padding: spacing.l,
    zIndex: 4,
  },
  menuTitle: {color: colors.text, fontSize: fonts.heading, fontWeight: '700', marginBottom: spacing.m},
});
