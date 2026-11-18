// Automatic stream choice: reads the quality markers stream add-ons put in
// their names (Torrentio, AIOStreams, Comet, MediaFusion…) and ranks every
// stream for what the Fire TV Stick 4K Select and a 4K HDR TV can actually play.
//
// Device facts (Vega 2.0 media docs, device reviews):
// - video: H.264, HEVC (10-bit, HDR10/HDR10+/HLG), AV1, VP9. No Dolby Vision on
//   the 4K Select: DV-only files (no HDR10 base layer) show wrong colours.
// - audio: AAC, AC-3, E-AC-3 (Dolby Digital Plus, incl. Atmos as passthrough),
//   AC-4, FLAC, Opus, MP3. TrueHD is not listed; DTS is HDMI passthrough only.
// - HLS/DASH need an MSE player this app does not ship yet.
import {Stream} from './types';

export interface StreamTraits {
  resolution: number; // 2160, 1440, 1080, 720, 480 or 0 when unknown
  hdr10plus: boolean;
  hdr: boolean;
  dolbyVision: boolean;
  dolbyVisionOnly: boolean;
  hlg: boolean;
  atmos: boolean;
  ddPlus: boolean;
  ac3: boolean;
  trueHd: boolean;
  dts: boolean;
  hevc: boolean;
  av1: boolean;
  remux: boolean;
  webDl: boolean;
  bluRay: boolean;
  cam: boolean;
  sizeGb: number; // 0 when unknown
  /** An MP4 file (plays in the platform's own player). */
  mp4: boolean;
  /** An IPTV-panel film link (one connection per account, no skipping). */
  iptvVod: boolean;
  seeders: number; // -1 when unknown
  cached: boolean; // instantly available (debrid cache or plain HTTP)
  uncached: boolean; // debrid stream that would have to download first
  torrent: boolean;
  adaptive: boolean; // HLS/DASH manifest
  external: boolean;
  english: boolean;
  multiAudio: boolean;
  foreignOnly: boolean;
}

export interface RankedStream {
  stream: Stream;
  addonName: string;
  traits: StreamTraits;
  score: number;
  /** Short, clean description such as "4K · HDR10 · Dolby Atmos". */
  summary: string;
  playable: boolean;
}

function streamText(stream: Stream): string {
  return [stream.name, stream.title, stream.description, stream.behaviorHints?.filename].filter(Boolean).join('\n');
}

const FOREIGN = /\b(french|truefrench|vostfr|vff|vfq|italian|ita|spanish|español|castellano|latino|german|deutsch|ger|hindi|tamil|telugu|malayalam|kannada|russian|rus|polish|pol|portuguese|dublado|turkish|arabic|korean|japanese|chinese|dutch|czech|hungarian)\b|🇫🇷|🇮🇹|🇪🇸|🇲🇽|🇩🇪|🇮🇳|🇷🇺|🇵🇱|🇵🇹|🇧🇷|🇹🇷|🇳🇱|🇨🇿|🇭🇺|🇰🇷|🇯🇵|🇨🇳/i;
const ENGLISH = /\b(eng|english)\b|🇬🇧|🇺🇸/i;

export function analyseStream(stream: Stream): StreamTraits {
  const text = streamText(stream);
  const t = text.toLowerCase();
  const url = stream.url || '';

  let resolution = 0;
  if (/\b(2160p|4k|uhd)\b/i.test(text)) {
    resolution = 2160;
  } else if (/\b1440p\b/i.test(text)) {
    resolution = 1440;
  } else if (/\b(1080p|fhd)\b/i.test(text)) {
    resolution = 1080;
  } else if (/\b720p\b/i.test(text)) {
    resolution = 720;
  } else if (/\b(480p|576p|360p|sd)\b/i.test(text)) {
    resolution = 480;
  }

  const hdr10plus = /hdr10\+|hdr10plus|hdr10 plus/i.test(text);
  const hdr = hdr10plus || /\bhdr(10)?\b/i.test(text);
  const dolbyVision = /\b(dv|dovi|dolby[ ._-]?vision)\b/i.test(text);
  const hlg = /\bhlg\b/i.test(text);

  const ddPlus = /\b(ddp|dd\+|eac3|e-ac-3|dolby digital plus)/i.test(text);
  const trueHd = /truehd/i.test(text);
  const dts = /\bdts/i.test(text);
  const ac3 = /\b(ac3|dd5\.?1|dd2\.?0|dolby digital)\b/i.test(text) || /\bdd\b/i.test(text);
  const atmos = /atmos/i.test(text);

  const sizeMatch = /(?:💾|size[:\s]*)?\s*(\d+(?:[.,]\d+)?)\s*(gb|gib|mb|mib)\b/i.exec(text);
  let sizeGb = 0;
  if (sizeMatch) {
    const value = Number(sizeMatch[1].replace(',', '.'));
    sizeGb = /m/i.test(sizeMatch[2]) ? value / 1024 : value;
  } else if (stream.behaviorHints?.videoSize) {
    sizeGb = stream.behaviorHints.videoSize / 1024 ** 3;
  }
  const seedMatch = /(?:👤|seeders?[:\s]*|peers?[:\s]*)\s*(\d+)/i.exec(text);

  const torrent = !!stream.infoHash || url.startsWith('magnet:');
  const httpUrl = /^https?:\/\//i.test(url);
  // Placeholder videos ("Not ready yet", "downloading…") some add-ons return instead of the film.
  const placeholder = /\/slate[./]|[?&]title=not\+ready|not ready yet|still downloading|added to (your )?(debrid|download)|download (started|queued)/i.test(`${url}\n${text}`);
  const uncached = placeholder || /⏳|\buncached\b|\[(rd|ad|pm|tb|dl|ed|oc|pp)\s*(download|dl)\]|not cached/i.test(text);
  const cached = !uncached && (httpUrl || /⚡|\binstant\b|\bcached\b|\[(rd|ad|pm|tb|dl|ed|oc|pp)\+\]/i.test(text));

  const english = ENGLISH.test(text);
  const multiAudio = /\b(multi|dual[ ._-]?audio|multi[ ._-]?audio)\b/i.test(text);
  const foreignOnly = FOREIGN.test(text) && !english && !multiAudio;

  return {
    resolution,
    hdr10plus,
    hdr,
    dolbyVision,
    // Profile 8 releases carry an HDR10 base layer and are usually tagged "DV HDR".
    dolbyVisionOnly: dolbyVision && !hdr,
    hlg,
    atmos,
    ddPlus,
    ac3,
    trueHd,
    dts,
    hevc: /\b(x265|h\.?265|hevc)\b/i.test(text),
    av1: /\bav1\b/i.test(text),
    remux: /\bremux\b/i.test(text),
    webDl: /\bweb[ ._-]?(dl|rip)?\b/i.test(t),
    bluRay: /\b(blu[ ._-]?ray|bdrip|brrip)\b/i.test(text),
    cam: /\b(cam|camrip|hdcam|telesync|hdts|hd-ts|telecine|hdtc)\b|\bts\b(?!\w)/i.test(text) && !/\b(m2ts|mpeg-ts)\b/i.test(text),
    sizeGb,
    mp4: /\.mp4\b/i.test(`${stream.behaviorHints?.filename || ''}\n${text}`),
    iptvVod: /\/(?:vod\/)?(?:movie|series)\/(?:[^/?]+\/){0,2}\d+\.(?:mkv|mp4|avi|ts)(?:\?|$)/i.test(url),
    seeders: seedMatch ? Number(seedMatch[1]) : -1,
    cached,
    uncached,
    torrent,
    adaptive: /\.(m3u8|mpd)(\?|$)/i.test(url) || placeholder,
    external: !url && !stream.infoHash && !stream.ytId && !!stream.externalUrl,
    english,
    multiAudio,
    foreignOnly,
  };
}

export function summarise(traits: StreamTraits): string {
  const parts: string[] = [];
  if (traits.resolution === 2160) {
    parts.push('4K');
  } else if (traits.resolution) {
    parts.push(`${traits.resolution}p`);
  }
  if (traits.hdr10plus) {
    parts.push('HDR10+');
  } else if (traits.hdr) {
    parts.push('HDR10');
  } else if (traits.hlg) {
    parts.push('HLG');
  } else if (traits.dolbyVision) {
    parts.push('Dolby Vision');
  }
  if (traits.atmos) {
    parts.push('Dolby Atmos');
  } else if (traits.ddPlus) {
    parts.push('Dolby Digital Plus');
  } else if (traits.ac3) {
    parts.push('Dolby Digital');
  }
  return parts.join(' · ');
}

export interface PickerOptions {
  /** True when the Stremio streaming server on the PC is configured. */
  hasServer: boolean;
  /** Running time of the film or episode (minutes), to turn file size into bitrate. */
  runtimeMin?: number;
  /** Measured download speed of the in-app MKV engine on this device (Mbit/s). */
  mkvMbps?: number;
  /** Highest average bitrate (Mbit/s) that plays here without stalling. */
  maxMbps?: number;
}

/** Average bitrate (Mbit/s) of a file of this size over this running time, 0 when unknown. */
export function averageMbps(sizeGb: number, runtimeMin?: number): number {
  return sizeGb > 0 && runtimeMin && runtimeMin > 0 ? (sizeGb * 8589.93) / (runtimeMin * 60) : 0;
}

/** What the connection carries without stalling (learned from playback), 0 = no limit. */
export function budgetMbps(options: PickerOptions, _mp4: boolean): number {
  return options.maxMbps || 0;
}

/** Higher is better. Streams that cannot play on this device get a large negative score. */
export function scoreStream(traits: StreamTraits, options: PickerOptions): number {
  let score = 0;

  // Things this device or setup cannot play at all.
  if (traits.adaptive || traits.external || traits.cam) {
    score -= 5000;
  }
  if (traits.torrent && !options.hasServer) {
    score -= 5000;
  }

  // Picture.
  score += {2160: 400, 1440: 330, 1080: 300, 720: 180, 480: 60}[traits.resolution as 2160] ?? 150;
  if (traits.hdr10plus) {
    score += 70;
  } else if (traits.hdr) {
    score += 60;
  } else if (traits.hlg) {
    score += 30;
  }
  if (traits.dolbyVisionOnly) {
    score -= 400; // No Dolby Vision on the 4K Select: wrong colours.
  }
  if (traits.hevc) {
    score += 20;
  } else if (traits.av1) {
    score += 15;
  }

  // Sound.
  const dolbyCore = traits.ddPlus || traits.ac3;
  if (traits.atmos && (traits.ddPlus || !traits.trueHd)) {
    score += 60;
  } else if (traits.ddPlus) {
    score += 40;
  } else if (traits.ac3) {
    score += 25;
  }
  if (traits.trueHd && !dolbyCore) {
    score -= 150; // Not decodable here and not a safe passthrough.
  }
  if (traits.dts && !dolbyCore && !traits.trueHd) {
    score -= 60; // Passthrough only.
  }

  // Source and size (huge remuxes stall on Wi-Fi).
  if (traits.webDl) {
    score += 30;
  } else if (traits.bluRay) {
    score += 20;
  }
  if (traits.sizeGb > 40) {
    score -= 90;
  } else if (traits.sizeGb > 25) {
    score -= 35;
  }
  // Smooth beats sharp: a version the connection cannot carry buffers, so it drops below
  // ones that fit (4K returns by itself when the measured speed allows it).
  const bitrate = averageMbps(traits.sizeGb, options.runtimeMin);
  const budget = budgetMbps(options, traits.mp4);
  if (bitrate && budget && bitrate > budget) {
    score -= 250 + Math.min(400, (bitrate / budget - 1) * 300);
  }
  if (traits.mp4) {
    score += 0; // no MP4 preference: some MP4s are fragmented and stall in the platform player
  }
  if (traits.iptvVod) {
    // IPTV-panel film links (".../movie/123.mkv"): one connection per account, no skipping,
    // refused while live TV is in use. Debrid links win whenever there are any.
    score -= 300;
  }

  // Start-up speed and reliability.
  if (traits.cached) {
    score += 150;
  } else if (traits.uncached) {
    score -= 300;
  } else if (traits.torrent) {
    score += traits.seeders < 0 ? 0 : Math.min(traits.seeders, 200) / 4 - (traits.seeders < 5 ? 120 : 0);
  }

  // Language: the audio menu cannot always switch tracks, so prefer English.
  if (traits.foreignOnly) {
    score -= 350;
  } else if (traits.english) {
    score += 40;
  } else if (traits.multiAudio) {
    score -= 20;
  }
  return score;
}

/** Ranks every stream from every add-on, best first. */
export function rankStreams(groups: {addonName: string; streams: Stream[]}[], options: PickerOptions): RankedStream[] {
  const ranked: (RankedStream & {order: number})[] = [];
  let order = 0;
  groups.forEach((group, groupIndex) => {
    group.streams.forEach((stream) => {
      const traits = analyseStream(stream);
      // Small tie-breaker that keeps the user's add-on order.
      const score = scoreStream(traits, options) - groupIndex * 2;
      ranked.push({stream, addonName: group.addonName, traits, score, summary: summarise(traits), playable: score > -1000, order: order++});
    });
  });
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.map(({order: _order, ...rest}) => rest);
}
