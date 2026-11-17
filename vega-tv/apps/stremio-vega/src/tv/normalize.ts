// Turns an IPTV provider's channel name such as
//   "|UK| Sky Sports Main Events ᵁᴴᴰ", "UK - SKY SPORTS MAIN EVENTS UHD",
//   "VIP: SKY SPORTS ACTION ᴿᴬᵂ ʰᵉᵛᶜ"
// into a matching key ("sky sports main event") and a quality score, so the
// same channel from different providers can be merged and ranked.
import {plainLetters} from './letters';

export interface ParsedName {
  key: string;
  /** 1 = SD/low, 2 = HD (or unknown), 3 = Full HD / raw feed, 4 = UHD/4K. */
  quality: number;
  hevc: boolean;
  fps60: boolean;
  timeshift: boolean;
}

const PREFIXES = [
  /^\s*\|?\s*[A-Z0-9][A-Z0-9 +&.\-]{0,11}\s*\|\s*/, // "UK|", "|UK|", "UK-NOWTV|", "US| "
  /^\s*[A-Z0-9+]{1,7}\s*:\s*/, // "VIP:", "UK:", "8K:", "PLAY+:", "GOLD:"
  /^\s*(?:UK|US|USA|GB|IE|EN)\s+-\s+/, // "UK - "
];

const NOISE =
  /\b(?:UHD|FHD|HD|SD|4K|8K|HEVC|H\.?26[45]|RAW|VIP|LQ|HQ|ULTRA|LOW|BACKUP|BK|MULTI|ORIGINAL|INF|\d{3,4}P|\d{2}\s?FPS|DOLBY(?:\s+AUDIO)?|ATMOS|PREMIUM|SUPER)\b/gi;

export function parseChannelName(raw: string): ParsedName {
  let s = plainLetters(String(raw || ''));
  s = s.replace(/([A-Za-z])⚽([A-Za-z])/g, '$1o$2'); // "SP⚽RTS"
  for (let pass = 0; pass < 3; pass++) {
    for (const re of PREFIXES) {
      s = s.replace(re, '');
    }
  }
  // Quality is read after the provider prefix is gone ("8K: ... LQ" is low quality).
  const upper = s.toUpperCase();
  const timeshift = /\+\s?(?:1|24)\b|\bTIMESHIFT\b/.test(upper);
  let quality = 2;
  if (/\b(?:UHD|4K|8K|2160P?|3840P?)\b/.test(upper)) {
    quality = 4;
  } else if (/\b(?:FHD|1080P?|RAW)\b/.test(upper)) {
    quality = 3;
  } else if (/\b(?:HD|720P?)\b/.test(upper)) {
    quality = 2;
  }
  if (/\b(?:SD|LQ|LOW|480P?|360P?)\b/.test(upper)) {
    quality = 1;
  }
  const hevc = /\b(?:HEVC|H\.?265)\b/.test(upper);
  const fps60 = /\b(?:50|60)\s?FPS\b/.test(upper);
  s = s
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\+\s?(?:1|24)\b/g, ' ')
    .replace(NOISE, ' ')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s\+\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {key: canonicalKey(s), quality, hevc, fps60, timeshift};
}

/** Spelling variants that providers use for the same channel. */
const REWRITES: [RegExp, string][] = [
  [/^sky sport /, 'sky sports '],
  [/^sky sports main events?$/, 'sky sports main event'],
  [/^sky sports pl$/, 'sky sports premier league'],
  [/^sky sports f 1$/, 'sky sports f1'],
  [/^sky sports formula 1$/, 'sky sports f1'],
  [/^sky sports (\w+) uk$/, 'sky sports $1'],
  [/^tnt sport (\d)$/, 'tnt sports $1'],
  [/^bt sports? (\d)$/, 'tnt sports $1'],
  [/^tnt sports (\d) uk$/, 'tnt sports $1'],
  [/^bbc 1$|^bbc one (?:london|hd|england)$/, 'bbc one'],
  [/^bbc 2$|^bbc two (?:england|hd)$/, 'bbc two'],
  [/^itv 1$|^itv1 (?:london|hd)$|^itv london$|^itv$/, 'itv1'],
  [/^itv (\d)$/, 'itv$1'],
  [/^ch(?:annel)? ?4$/, 'channel 4'],
  [/^ch(?:annel)? ?5$|^five$/, 'channel 5'],
  [/^e 4$/, 'e4'],
  [/^more 4$/, 'more4'],
  [/^film 4$/, 'film4'],
  [/^u ?(dave|gold|alibi|drama|w|yesterday)$/, '$1'],
  [/^uk ?tv ?(dave|gold|alibi|drama|w|yesterday)$/, '$1'],
  [/^u and (dave|gold|alibi|drama|w|yesterday)$/, '$1'],
  [/^al jazeera(?: english| eng| en)?$/, 'al jazeera english'],
  [/^premier sports? (\d)$/, 'premier sports $1'],
  [/^euro ?sport (\d)$/, 'eurosport $1'],
  [/^(abc|cbs|nbc|fox) (?:east|new york|ny|hd)$/, '$1'],
  [/^espn ?2$/, 'espn2'],
  [/^fs ?1$|^fox sports 1$/, 'fs1'],
  [/^fs ?2$|^fox sports 2$/, 'fs2'],
  [/^hbo (?:east|hd)$/, 'hbo'],
  [/^msnbc$|^ms now$/, 'msnbc'],
];

export function canonicalKey(key: string): string {
  let k = key;
  for (const [re, to] of REWRITES) {
    if (re.test(k)) {
      k = k.replace(re, to);
    }
  }
  return k;
}
