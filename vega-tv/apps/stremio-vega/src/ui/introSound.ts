// The launch sound (an original whoosh, low hit and chord, made for this app). Played
// once by the intro, then the audio player is released so it never competes with the
// video player. Any failure just means a silent intro.
import {Image} from 'react-native';
import {AudioContentType, AudioPlayer, AudioUsageType} from '@amazon-devices/react-native-w3cmedia';
import {loadJson} from '../../../../shared/src/storage';

import {INTRO_SOUND_KEY} from './soundKeys';

const log = (line: string) => console.log(`[stremio] intro sound: ${line}`);

/**
 * Starts the sound; resolves once it is playing (or has failed, or after `maxWaitMs`),
 * so the picture can start in step with it.
 */
export function playIntroSound(maxWaitMs = 700): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const timer = setTimeout(() => {
      log('slow to start; picture goes ahead');
      finish();
    }, maxWaitMs);
    (async () => {
      let player: AudioPlayer | null = null;
      try {
        if ((await loadJson<boolean>(INTRO_SOUND_KEY, true)) === false) {
          throw new Error('switched off in Settings');
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const uri = Image.resolveAssetSource(require('./sounds/intro.mp3'))?.uri;
        if (!uri) {
          throw new Error('sound file not in the app');
        }
        player = new AudioPlayer(AudioContentType.CONTENT_TYPE_SONIFICATION, AudioUsageType.USAGE_MEDIA);
        await player.initialize();
        player.src = uri;
        player.volume = 0.8;
        await player.play();
        log(`playing ${uri.slice(-40)}`);
      } catch (e: any) {
        log(`off (${e?.message || e})`);
      } finally {
        clearTimeout(timer);
        finish();
        // Released once the sound has finished.
        const p = player;
        if (p) {
          setTimeout(() => {
            p.pause?.();
            p.deinitialize().catch(() => undefined);
          }, 3500);
        }
      }
    })();
  });
}
