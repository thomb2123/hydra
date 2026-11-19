// Menu sounds (original, made for this app): a soft tick when moving, a rising pop on
// OK, a falling pair on Back, a whoosh when a page opens, a chime for favourites and a
// low tone when something fails. Each is loaded once into its own audio player so it
// plays at once; all are released while a film or channel plays (no sounds there, and
// the video player gets the stick's audio resources), and they can be switched off.
import {Image} from 'react-native';
import {AudioContentType, AudioPlayer, AudioUsageType} from '@amazon-devices/react-native-w3cmedia';

export type UiSound = 'move' | 'select' | 'back' | 'open' | 'toggle' | 'error';

/* eslint-disable @typescript-eslint/no-var-requires */
const FILES: Record<UiSound, number> = {
  move: require('./sounds/move.mp3'),
  select: require('./sounds/select.mp3'),
  back: require('./sounds/back.mp3'),
  open: require('./sounds/open.mp3'),
  toggle: require('./sounds/toggle.mp3'),
  error: require('./sounds/error.mp3'),
};
/* eslint-enable @typescript-eslint/no-var-requires */

const VOLUME: Record<UiSound, number> = {move: 0.35, select: 0.55, back: 0.55, open: 0.5, toggle: 0.6, error: 0.6};
/** Fewer ticks than presses when a direction is held down. */
const MIN_GAP_MS: Partial<Record<UiSound, number>> = {move: 70};

const players = new Map<UiSound, AudioPlayer>();
const lastPlayed = new Map<UiSound, number>();
let enabled = true;
let suspended = true; // until load() after the intro
let loading: Promise<void> | null = null;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const log = (line: string) => console.log(`[stremio] ui sound: ${line}`);

/** On/off from Settings. Turning off releases the players. */
export function setUiSoundsEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    release();
  } else if (!suspended) {
    load();
  }
}

/** Suspended while video plays (players released), resumed afterwards. */
export function setUiSoundsSuspended(value: boolean): void {
  if (value === suspended) {
    return;
  }
  suspended = value;
  if (value) {
    release();
  } else if (enabled) {
    load();
  }
}

function load(): Promise<void> {
  if (loading) {
    return loading;
  }
  loading = (async () => {
    // Not while the home screen is being built: a few seconds later, one player at a time.
    await wait(3000);
    await releasing;
    for (const name of Object.keys(FILES) as UiSound[]) {
      if (suspended || !enabled || players.has(name)) {
        continue;
      }
      await wait(150);
      try {
        const uri = Image.resolveAssetSource(FILES[name])?.uri;
        if (!uri) {
          continue;
        }
        const player = new AudioPlayer(AudioContentType.CONTENT_TYPE_SONIFICATION, AudioUsageType.USAGE_MEDIA);
        await player.initialize();
        player.src = uri;
        player.volume = VOLUME[name];
        (player as any).preload = 'auto';
        (player as any).load?.();
        players.set(name, player);
      } catch (e: any) {
        log(`${name} unavailable (${e?.message || e})`);
      }
    }
    log(`${players.size} of ${Object.keys(FILES).length} ready`);
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Finishes when every menu-sound player has been released (resolved when there are none). */
let releasing: Promise<void> = Promise.resolve();

function release(): void {
  const toRelease = [...players.values()];
  players.clear();
  if (!toRelease.length) {
    return;
  }
  const previous = releasing;
  // One at a time, each given up to 1.5 s, so the audio system is never asked to tear
  // down six players at the moment a video player is being set up.
  releasing = (async () => {
    await previous;
    for (const player of toRelease) {
      try {
        player.pause();
      } catch {
        // already stopped
      }
      await Promise.race([player.deinitialize().catch(() => undefined), wait(1500)]);
    }
    log(`released ${toRelease.length}`);
  })();
}

/**
 * Called by the film and live TV players before they create any video: stops the menu
 * sounds and resolves once their audio players are gone.
 */
export function releaseUiSoundsForVideo(): Promise<void> {
  setUiSoundsSuspended(true);
  return Promise.race([releasing, wait(6000)]);
}

export function playUiSound(name: UiSound): void {
  if (!enabled || suspended) {
    return;
  }
  const now = Date.now();
  const gap = MIN_GAP_MS[name];
  if (gap && now - (lastPlayed.get(name) || 0) < gap) {
    return;
  }
  lastPlayed.set(name, now);
  const player = players.get(name);
  if (!player) {
    return;
  }
  try {
    player.currentTime = 0;
    const started = player.play();
    if (started && typeof (started as any).catch === 'function') {
      (started as Promise<void>).catch(() => undefined);
    }
  } catch {
    // a missed click is not worth reporting
  }
}
