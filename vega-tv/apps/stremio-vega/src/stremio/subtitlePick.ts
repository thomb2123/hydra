// Orders subtitles so the one most likely to be in sync comes first:
// language, then a video-hash match, then how closely the subtitle's release
// name matches the file being played (same source, group and cut usually means
// the same timing).
import {Subtitle} from './types';

const LANGUAGE_ORDER = ['eng', 'en', 'english'];

function languageRank(lang: string): number {
  const index = LANGUAGE_ORDER.indexOf(String(lang || '').toLowerCase());
  return index === -1 ? 10 : index;
}

const NOISE = new Set(['the', 'a', 'and', 'of', 'srt', 'mkv', 'mp4', 'avi', 'eng', 'english', 'en', 'sub', 'subs']);

export function releaseTokens(name: string): Set<string> {
  return new Set(
    String(name || '')
      .toLowerCase()
      .replace(/web[ ._-]?dl/g, 'webdl')
      .replace(/web[ ._-]?rip/g, 'webrip')
      .replace(/blu[ ._-]?ray/g, 'bluray')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !NOISE.has(t)),
  );
}

/** 0..1: share of tokens in common between two release names. */
export function releaseSimilarity(a: string, b: string): number {
  const x = releaseTokens(a);
  const y = releaseTokens(b);
  if (!x.size || !y.size) {
    return 0;
  }
  let common = 0;
  x.forEach((t) => y.has(t) && common++);
  return common / Math.min(x.size, y.size);
}

export function subtitleMatchScore(sub: Subtitle, filename: string): number {
  let score = 0;
  if (sub.m === 'h') {
    score += 100; // Hash match: made for this exact file.
  }
  if (filename) {
    score += 50 * Math.max(releaseSimilarity(sub.movieReleaseName || '', filename), releaseSimilarity(sub.subtitleFileName || '', filename));
  }
  return score;
}

/** Sorted copy: preferred language first, then best match for `filename`, keeping add-on order on ties. */
export function rankSubtitles<T extends Subtitle>(subs: T[], filename: string): T[] {
  return subs
    .map((sub, index) => ({sub, index, lang: languageRank(sub.lang), match: subtitleMatchScore(sub, filename)}))
    .sort((a, b) => a.lang - b.lang || b.match - a.match || a.index - b.index)
    .map((entry) => entry.sub);
}
