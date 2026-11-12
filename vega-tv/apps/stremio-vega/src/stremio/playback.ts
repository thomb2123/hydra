// Builds a PlaySource for a chosen stream: resolves torrents/proxies through
// the PC server, gathers subtitles and works out where to resume.
import {ExternalSubtitle, PlaySource} from '../../../../shared/src/player/VideoScreen';
import {SourcedSubtitle, fetchSubtitles} from './addons';
import {resolveStream, subtitleViaServer} from './streaming';
import {MetaDetail, Stream, Video} from './types';
import {rankSubtitles} from './subtitlePick';
import {StremioState} from '../state';

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English', en: 'English', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German',
  ita: 'Italian', por: 'Portuguese', pob: 'Portuguese (BR)', dut: 'Dutch', nld: 'Dutch', pol: 'Polish',
  rus: 'Russian', ara: 'Arabic', tur: 'Turkish', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish',
  gre: 'Greek', ell: 'Greek', heb: 'Hebrew', hin: 'Hindi', jpn: 'Japanese', kor: 'Korean', chi: 'Chinese', zho: 'Chinese',
};

export function languageName(lang: string): string {
  const code = String(lang || '').toLowerCase();
  return LANGUAGE_NAMES[code] || (code ? code.toUpperCase() : 'Unknown');
}

export function videoIdOf(meta: MetaDetail, video: Video | null): string {
  return video ? video.id : meta.behaviorHints?.defaultVideoId || meta.id;
}

export function playTitle(meta: MetaDetail, video: Video | null): string {
  if (!video) {
    return meta.name;
  }
  const number = video.season != null && video.episode != null ? `S${video.season}:E${video.episode} ` : '';
  return `${meta.name} · ${number}${video.title || video.name || ''}`.trim();
}

/** "S1:E3 · Rollercoaster" for an episode, undefined for a film. */
export function episodeLine(video: Video | null): string | undefined {
  if (!video) {
    return undefined;
  }
  const number = video.season != null && video.episode != null ? `S${video.season}:E${video.episode}` : '';
  return [number, video.title || video.name].filter(Boolean).join(' · ') || undefined;
}

/** The episode after `video` (next in the season, else first of the next season). */
export function nextEpisode(meta: MetaDetail, video: Video | null): Video | null {
  if (!video || !meta.videos) {
    return null;
  }
  const ordered = meta.videos
    .filter((v) => v && v.id && (v.season ?? 0) > 0)
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
  const index = ordered.findIndex((v) => v.id === video.id);
  return index >= 0 && index + 1 < ordered.length ? ordered[index + 1] : null;
}

const subtitleCache = new Map<string, Promise<SourcedSubtitle[]>>();

/** All add-on subtitles for a title, cached for the session. */
export function subtitleList(state: StremioState, type: string, videoId: string): Promise<SourcedSubtitle[]> {
  const key = `${type}|${videoId}`;
  if (!subtitleCache.has(key)) {
    const promise = fetchSubtitles(state.addons, type, videoId).catch(() => [] as SourcedSubtitle[]);
    subtitleCache.set(key, promise);
  }
  return subtitleCache.get(key) as Promise<SourcedSubtitle[]>;
}

export async function prepareSource(
  state: StremioState,
  meta: MetaDetail,
  video: Video | null,
  stream: Stream,
  detail: string,
  probe?: {frameRate?: number},
  /** Already-checked address to play (e.g. after following redirects). */
  urlOverride?: string,
): Promise<PlaySource> {
  const videoId = videoIdOf(meta, video);
  const episode = video ? {season: video.season, episode: video.episode} : undefined;
  const resolved = urlOverride ? {url: urlOverride, note: undefined as string | undefined} : await resolveStream(stream, state.server, episode);

  const hints = stream.behaviorHints || {};
  // Subtitle lists are fetched once per title (usually already prefetched) and then
  // ranked against this stream's release name, so starting playback does not wait.
  const fromAddons = await subtitleList(state, meta.type, videoId);
  const filename = hints.filename || [stream.title, stream.description].filter(Boolean).join(' ');
  const all = rankSubtitles([...(stream.subtitles || []).map((s) => ({...s, source: 'Stream'})), ...fromAddons], filename).slice(0, 40);
  const counts: Record<string, number> = {};
  const subtitles: ExternalSubtitle[] = all.map((sub, index) => {
    const key = `${sub.lang}|${sub.source}`;
    counts[key] = (counts[key] || 0) + 1;
    // Prefer the PC server (it re-encodes to UTF-8 WebVTT) and fall back to the direct address.
    const viaServer = state.server ? subtitleViaServer(state.server, sub.url) : undefined;
    return {
      id: `${sub.id || index}-${index}`,
      label: index === 0 && filename ? `${languageName(sub.lang)} · best match` : `${languageName(sub.lang)} · ${sub.source} ${counts[key]}`,
      language: sub.lang,
      url: viaServer || sub.url,
      fallbackUrl: viaServer ? sub.url : undefined,
      fps: sub.fpsMilli ? sub.fpsMilli / 1000 : undefined,
    };
  });

  const resume = state.resume[videoId];
  const libraryItem = state.library.find((item) => item._id === meta.id);
  // Resume from whichever saved place is further in: this device or the Stremio account.
  const local = resume && (!resume.duration || resume.position < resume.duration - 60) ? resume.position : 0;
  const account =
    libraryItem && (libraryItem.state.video_id === videoId || (!libraryItem.state.video_id && !video)) ? (libraryItem.state.timeOffset || 0) / 1000 : 0;
  const best = Math.max(local, account);
  const startAt = best > 30 ? best : 0;
  // No alternative route: Vega's player rejects the Stremio server's /proxy/ addresses
  // ("Invalid or insecure URI scheme"), so seeking is handled in the player itself.
  const url = resolved.url;
  const altUrl: string | undefined = undefined;
  return {
    url,
    altUrl,
    title: meta.name,
    subtitle: episodeLine(video),
    detail: [detail, resolved.note].filter(Boolean).join(' · '),
    subtitles,
    startAt,
    videoFps: probe?.frameRate,
  };
}
