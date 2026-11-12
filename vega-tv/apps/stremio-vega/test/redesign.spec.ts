import {analyseStream, rankStreams, scoreStream, summarise} from '../src/stremio/streamPicker';
import {classify, genreSources, rowTitle, rowsForTab} from '../src/stremio/rows';
import {rankSubtitles, releaseSimilarity} from '../src/stremio/subtitlePick';
import {probeVerdict} from '../src/stremio/streaming';
import {AddonDescriptor} from '../src/stremio/types';
import {rescaleCues} from '../../../shared/src/subtitles';

const s = (name: string, title: string, extra: Record<string, any> = {}) => ({name, title, url: 'https://debrid.example/file.mkv', ...extra});

describe('stream picker', () => {
  it('reads quality markers', () => {
    const t = analyseStream(s('[RD+] AIOStreams 4K', 'Movie.2024.2160p.WEB-DL.DDP5.1.Atmos.HDR10.H.265\n💾 18.2 GB'));
    expect(t.resolution).toBe(2160);
    expect(t.hdr).toBe(true);
    expect(t.atmos).toBe(true);
    expect(t.ddPlus).toBe(true);
    expect(t.hevc).toBe(true);
    expect(t.cached).toBe(true);
    expect(Math.round(t.sizeGb)).toBe(18);
    expect(summarise(t)).toBe('4K · HDR10 · Dolby Atmos');
  });

  it('flags Dolby Vision without an HDR10 base layer', () => {
    expect(analyseStream(s('4K', 'Movie 2160p DV WEB-DL')).dolbyVisionOnly).toBe(true);
    expect(analyseStream(s('4K', 'Movie 2160p DV HDR10 WEB-DL')).dolbyVisionOnly).toBe(false);
  });

  it('prefers playable 4K HDR with Dolby audio, avoids DV-only, TrueHD-only, foreign and uncached', () => {
    const ranked = rankStreams(
      [
        {
          addonName: 'A',
          streams: [
            s('1080p', 'Movie 1080p WEB-DL DDP5.1 [RD+]'),
            s('4K', 'Movie 2160p DV WEB-DL DDP5.1 Atmos [RD+]'),
            s('4K', 'Movie 2160p REMUX TrueHD 7.1 Atmos HDR10 [RD+] 💾 62 GB'),
            s('4K', 'Movie 2160p WEB-DL HDR10 DDP5.1 Atmos [RD+] 💾 19 GB'),
            s('4K', 'Movie 2160p WEB-DL HDR10 DDP5.1 FRENCH [RD+]'),
            s('4K', 'Movie 2160p WEB-DL HDR10 DDP5.1 [RD download] ⏳'),
          ],
        },
      ],
      {hasServer: true},
    );
    expect(ranked[0].stream.title).toContain('HDR10 DDP5.1 Atmos [RD+]');
    const order = ranked.map((r) => r.stream.title as string);
    expect(order.indexOf('Movie 2160p DV WEB-DL DDP5.1 Atmos [RD+]')).toBeGreaterThan(order.indexOf('Movie 1080p WEB-DL DDP5.1 [RD+]'));
    expect(order[order.length - 1]).toMatch(/FRENCH|download/);
  });

  it('rejects torrents without the PC server, HLS and cam copies', () => {
    expect(scoreStream(analyseStream({infoHash: 'a'.repeat(40), title: '1080p 👤 200'} as any), {hasServer: false})).toBeLessThan(-1000);
    expect(scoreStream(analyseStream({url: 'https://x/live.m3u8', title: '1080p'} as any), {hasServer: true})).toBeLessThan(-1000);
    expect(scoreStream(analyseStream(s('CAM', 'Movie 2024 HDCAM 1080p')), {hasServer: true})).toBeLessThan(-1000);
  });
});

const manifest = (name: string, catalogs: any[]): AddonDescriptor => ({
  transportUrl: `https://${name.toLowerCase()}.example/manifest.json`,
  manifest: {id: name, name, resources: ['catalog'], types: ['movie', 'series'], catalogs},
});

describe('rows', () => {
  const genres = ['Action', 'Comedy', 'Drama', 'Thriller', 'Sci-Fi', 'Horror'];
  const addons = [
    manifest('Cinemeta', [
      {type: 'movie', id: 'top', name: 'Popular', extra: [{name: 'genre', options: genres}, {name: 'skip'}]},
      {type: 'series', id: 'top', name: 'Popular', extra: [{name: 'genre', options: genres}]},
      {type: 'movie', id: 'imdbRating', name: 'Featured'},
      {type: 'movie', id: 'year', extra: [{name: 'genre', isRequired: true, options: ['2026', '2025']}]},
    ]),
    manifest('AIOMetadata | ElfHosted', [
      {type: 'movie', id: 'tmdb.trending', name: 'TMDB Trending'},
      {type: 'movie', id: 'tmdb.popular', name: 'TMDB Popular'},
      {type: 'series', id: 'streaming.nfx', name: 'Netflix UK'},
    ]),
  ];

  it('gives catalogs clean titles without add-on names', () => {
    expect(rowTitle({type: 'movie', id: 'tmdb.trending', name: 'TMDB Trending'})).toBe('Trending Films');
    expect(rowTitle({type: 'series', id: 'streaming.nfx', name: 'Netflix UK'})).toBe('Series on Netflix in the UK');
    expect(rowTitle({type: 'movie', id: 'imdbRating', name: 'Featured'})).toBe('Top Rated Films');
    expect(classify({type: 'movie', id: 'top', name: 'Popular'}).kind).toBe('popular');
  });

  it('builds a home tab with Top 10, de-duplicated rows and genres', () => {
    const rows = rowsForTab('home', addons);
    const titles = rows.map((r) => r.title);
    expect(titles[0]).toBe('Top 10 Films Today');
    expect(titles).toContain('Trending Films');
    expect(titles.filter((t) => t === 'Popular Films')).toHaveLength(1);
    expect(titles).toContain('Comedy Films');
    expect(titles).toContain('Comedy Series');
    expect(titles.join(' ')).not.toMatch(/Cinemeta|AIOMetadata|ElfHosted|TMDB/);
  });

  it('keeps the Films tab to films and finds genre sources (not year lists)', () => {
    expect(rowsForTab('films', addons).every((r) => r.type === 'movie')).toBe(true);
    const sources = genreSources(addons);
    expect(sources.map((g) => g.type).sort()).toEqual(['movie', 'series']);
    expect(sources[0].genres).toContain('Action');
  });
});

describe('subtitle timing', () => {
  it('ranks subtitles matching the release first within a language', () => {
    const subs = [
      {id: '1', url: 'u1', lang: 'eng', movieReleaseName: 'Show.S01E01.720p.HDTV.x264-GRP'},
      {id: '2', url: 'u2', lang: 'fre', movieReleaseName: 'Show.S01E01.1080p.WEB-DL.DDP5.1.H.264-NTb'},
      {id: '3', url: 'u3', lang: 'eng', movieReleaseName: 'Show.S01E01.1080p.WEB-DL.DDP5.1.H.264-NTb'},
    ];
    const ranked = rankSubtitles(subs, 'Show.S01E01.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv');
    expect(ranked.map((x) => x.id)).toEqual(['3', '1', '2']);
    expect(releaseSimilarity('a.1080p.web-dl', 'b.1080p.WEB.DL')).toBeGreaterThan(0.5);
  });

  it('rescales cues for a frame-rate mismatch only', () => {
    const cues = [{start: 100, end: 102, text: 'x'}];
    expect(rescaleCues(cues, 25, 23.976)[0].start).toBeCloseTo(104.27, 1);
    expect(rescaleCues(cues, 23.976, 23.976)).toBe(cues);
    expect(rescaleCues(cues, undefined, 25)).toBe(cues);
  });
});

describe('probe verdict', () => {
  it('rejects a non-English first audio track and DV-only video, accepts English', () => {
    const video = {track: 'video', frameRate: 23.976, isHdr: false, isDoVi: false};
    expect(probeVerdict({streams: [video, {track: 'audio', language: 'fre', codec: 'aac'}, {track: 'audio', language: 'eng'}]}).ok).toBe(false);
    expect(probeVerdict({streams: [video, {track: 'audio', language: 'eng', codec: 'eac3'}]})).toMatchObject({ok: true, frameRate: 23.976});
    expect(probeVerdict({streams: [{...video, isDoVi: true}, {track: 'audio', language: 'eng'}]}).ok).toBe(false);
    expect(probeVerdict({streams: [video, {track: 'audio', language: 'eng', codec: 'truehd'}]}).ok).toBe(false);
  });
});

describe('personal rows', () => {
  it('names Trakt catalogs like a streaming service', () => {
    expect(rowTitle({type: 'movie', id: 'recommendations', name: 'Trakt Recommendations'})).toBe('Trakt Picks for You · Films');
    expect(rowTitle({type: 'series', id: 'watchlist', name: 'Trakt Watchlist'})).toBe('My Watchlist · Series');
    expect(rowTitle({type: 'series', id: 'tmdb.airing_today', name: 'TMDB Airing Today'})).toBe('New Episodes Today');
  });
});

import {isInList, newLibraryItem, withListMembership, withProgress} from '../src/stremio/api';
import {continueWatching} from '../src/state';
import {nextEpisode} from '../src/stremio/playback';
import {pickSeeds, scoreCandidates} from '../src/stremio/recommend';

describe('library sync', () => {
  const meta = {id: 'tt1', type: 'movie', name: 'Film', poster: 'p'};

  it('watched-only items show in Continue Watching but not My List', () => {
    const watched = withProgress(newLibraryItem(meta, false), 'tt1', 600, 5400);
    expect(isInList(watched)).toBe(false);
    expect(continueWatching([watched]).map((i) => i._id)).toEqual(['tt1']);
  });

  it('adds to and removes from My List without losing progress', () => {
    const watched = withProgress(newLibraryItem(meta, false), 'tt1', 600, 5400);
    const listed = withListMembership(watched, true);
    expect(isInList(listed)).toBe(true);
    const unlisted = withListMembership(listed, false);
    expect(isInList(unlisted)).toBe(false);
    expect(continueWatching([unlisted])).toHaveLength(1);
    expect(isInList(newLibraryItem(meta, true))).toBe(true);
  });
});

describe('episodes', () => {
  it('finds the next episode across seasons', () => {
    const meta: any = {id: 's', type: 'series', name: 'S', videos: [
      {id: 'a', season: 1, episode: 1}, {id: 'b', season: 1, episode: 2}, {id: 'c', season: 2, episode: 1}, {id: 'x', season: 0, episode: 1},
    ]};
    expect(nextEpisode(meta, meta.videos[1])?.id).toBe('c');
    expect(nextEpisode(meta, meta.videos[2])).toBeNull();
    expect(nextEpisode(meta, null)).toBeNull();
  });
});

describe('recommendations', () => {
  it('orders seeds by recency and boosts My List', () => {
    const a = withProgress(newLibraryItem({id: 'a', type: 'movie', name: 'A'}, false), 'a', 100, 1000);
    const b = {...newLibraryItem({id: 'b', type: 'series', name: 'B'}, true), _mtime: '2020-01-01T00:00:00Z'};
    const seeds = pickSeeds([b, a]);
    expect(seeds[0].id).toBe('a');
    expect(seeds.find((s) => s.id === 'b')).toBeTruthy();
  });

  it('prefers titles found under several favourite genres and skips watched ones', () => {
    const list1 = {weight: 1, metas: [{id: 'x', type: 'movie', name: 'X'}, {id: 'y', type: 'movie', name: 'Y'}, {id: 'seen', type: 'movie', name: 'S'}]};
    const list2 = {weight: 0.8, metas: [{id: 'y', type: 'movie', name: 'Y'}]};
    const ranked = scoreCandidates([list1, list2], new Set(['seen']));
    expect(ranked.map((m) => m.id)).toEqual(['y', 'x']);
  });
});

describe('placeholder streams', () => {
  it('never picks "Not ready yet" slate videos', () => {
    const slate = analyseStream({url: 'https://slate.elfhosted.com/cache/x/slate.mp4?title=Not+ready+yet', title: '4K HDR10 DDP Atmos [RD+]'} as any);
    expect(scoreStream(slate, {hasServer: true})).toBeLessThan(-1000);
    expect(scoreStream(analyseStream({url: 'https://x/f.mkv', title: '2160p HDR10 [RD+]\nStill downloading'} as any), {hasServer: true})).toBeLessThan(-1000);
  });
});
