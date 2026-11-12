// Adaptive streaming (HLS/DASH) on Vega needs MSE mode plus a JavaScript player
// such as Amazon's patched Shaka Player. URL mode does not play manifests.
// Apps register a factory here once a Vega-patched player is bundled; until
// then the player screen explains why an HLS/DASH stream cannot start.
import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

export interface AdaptiveSession {
  unload(): void | Promise<void>;
}

export interface AdaptiveOptions {
  live: boolean;
  autoplay: boolean;
  startAt?: number;
}

export type AdaptiveFactory = (player: VideoPlayer, url: string, options: AdaptiveOptions) => AdaptiveSession;

let factory: AdaptiveFactory | null = null;

export function registerAdaptivePlayer(next: AdaptiveFactory | null): void {
  factory = next;
}

export function adaptivePlayer(): AdaptiveFactory | null {
  return factory;
}

export type DeliveryKind = 'hls' | 'dash' | 'progressive';

export function deliveryKind(url: string, mime?: string): DeliveryKind {
  const type = String(mime || '').toLowerCase();
  if (type.includes('mpegurl')) {
    return 'hls';
  }
  if (type.includes('dash')) {
    return 'dash';
  }
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.m3u8') || path.endsWith('.m3u')) {
    return 'hls';
  }
  if (path.endsWith('.mpd')) {
    return 'dash';
  }
  return 'progressive';
}
