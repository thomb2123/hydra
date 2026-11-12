// Parses SRT and WebVTT text into cues. Amazon recommends app-side parsing for
// external subtitle files (the URL-based addTextTrack variant is on the
// deprecation path), so the player feeds these cues to a text track as VTTCue
// objects.

export interface Cue {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}[.,]\d{1,3})/;

export function parseTimestamp(value: string): number {
  const parts = value.trim().replace(',', '.').split(':');
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + Number(part);
  }
  return Number.isFinite(seconds) ? seconds : NaN;
}

function cleanText(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/<\/?(?:i|b|u|font|c|v|ruby|rt|lang)[^>]*>/gi, '')
    .replace(/\{\\[^}]*\}/g, '') // SSA override tags that leak into SRT files
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line, index) => index > 0 || line.trim() !== '');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex === -1) {
      continue; // WEBVTT header, NOTE, STYLE or a malformed block.
    }
    const match = TIMING.exec(lines[timingIndex]);
    if (!match) {
      continue;
    }
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    const body = cleanText(lines.slice(timingIndex + 1));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !body) {
      continue;
    }
    cues.push({start, end, text: body});
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/**
 * Scales cue times when a subtitle was made for a different frame rate than the
 * video (e.g. 25 fps PAL subtitles on a 23.976 fps file drift ~4% late).
 * Returns the cues unchanged when either rate is unknown or they already match.
 */
export function rescaleCues(cues: Cue[], subtitleFps?: number, videoFps?: number): Cue[] {
  if (!subtitleFps || !videoFps || subtitleFps <= 1 || videoFps <= 1) {
    return cues;
  }
  const factor = subtitleFps / videoFps;
  if (Math.abs(factor - 1) < 0.005) {
    return cues;
  }
  return cues.map((cue) => ({...cue, start: cue.start * factor, end: cue.end * factor}));
}

/** Text of every cue showing at `time` (cues sorted by start), joined by newlines. */
export function cueTextAt(cues: Cue[], time: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lines: string[] = [];
  // Overlapping cues are rare and short-lived; a few steps back is enough.
  for (let i = last; i >= 0 && i > last - 8; i--) {
    if (cues[i].end > time) {
      lines.unshift(cues[i].text);
    }
  }
  return lines.join('\n');
}

export function looksLikeSubtitles(input: string): boolean {
  return /-->/.test(input.slice(0, 4000));
}
