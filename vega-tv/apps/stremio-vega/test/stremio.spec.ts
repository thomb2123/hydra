import {addonBase, boardCatalogs, encodeExtra, resourceUrl, searchCatalogs, supportsResource, usableAddons} from '../src/stremio/addons';
import {describeStream, normaliseServerUrl, parseMagnet, proxyUrl, subtitleViaServer, torrentUrl} from '../src/stremio/streaming';
import {withProgress} from '../src/stremio/api';
import {AddonDescriptor, LibraryItem, Manifest} from '../src/stremio/types';
import {cueTextAt, looksLikeSubtitles, parseSubtitles} from '../../../shared/src/subtitles';

const cinemeta: Manifest = {
  id: 'com.linvo.cinemeta',
  name: 'Cinemeta',
  resources: ['catalog', 'meta', 'addon_catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    {type: 'movie', id: 'top', extra: [{name: 'search'}, {name: 'skip'}]},
    {type: 'movie', id: 'year', extra: [{name: 'genre', isRequired: true}]},
    {type: 'series', id: 'top', extra: [{name: 'search'}]},
  ],
};

const streamsAddon: Manifest = {
  id: 'example.streams',
  name: 'Streams',
  resources: [{name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu']}],
  types: ['movie', 'series', 'anime'],
  catalogs: [],
};

describe('add-on protocol', () => {
  it('builds resource URLs like stremio-core', () => {
    expect(addonBase('https://v3-cinemeta.strem.io/manifest.json')).toBe('https://v3-cinemeta.strem.io');
    expect(resourceUrl('https://x.example/abc/manifest.json', 'stream', 'series', 'tt0903747:1:2')).toBe(
      'https://x.example/abc/stream/series/tt0903747%3A1%3A2.json',
    );
    expect(resourceUrl('https://v3-cinemeta.strem.io/manifest.json', 'catalog', 'movie', 'top', {search: 'big buck', skip: ''})).toBe(
      'https://v3-cinemeta.strem.io/catalog/movie/top/search=big%20buck.json',
    );
    expect(encodeExtra({genre: 'Sci-Fi & Fantasy'})).toBe('/genre=Sci-Fi%20%26%20Fantasy');
  });

  it('matches resources by type and id prefix', () => {
    expect(supportsResource(cinemeta, 'meta', 'movie', 'tt123')).toBe(true);
    expect(supportsResource(cinemeta, 'meta', 'movie', 'kitsu:1')).toBe(false);
    expect(supportsResource(cinemeta, 'stream', 'movie', 'tt123')).toBe(false);
    expect(supportsResource(streamsAddon, 'stream', 'series', 'kitsu:1:2')).toBe(true);
    expect(supportsResource(streamsAddon, 'stream', 'anime', 'tt1')).toBe(false);
  });

  it('selects board and search catalogs', () => {
    const addons: AddonDescriptor[] = [{transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: cinemeta}];
    expect(boardCatalogs(addons).map((c) => `${c.catalog.type}/${c.catalog.id}`)).toEqual(['movie/top', 'series/top']);
    expect(searchCatalogs(addons).map((c) => `${c.catalog.type}/${c.catalog.id}`)).toEqual(['movie/top', 'series/top']);
  });
});

describe('usableAddons', () => {
  const local: AddonDescriptor = {transportUrl: 'http://127.0.0.1:11470/local-addon/manifest.json', manifest: {...streamsAddon, id: 'local'}};
  const legacy: AddonDescriptor = {transportUrl: 'https://opensubtitles.strem.io/stremio/v1', manifest: {...streamsAddon, id: 'legacy'}};
  const remote: AddonDescriptor = {transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: cinemeta};

  it('drops local-server and legacy add-ons when no server is set', () => {
    expect(usableAddons([local, legacy, remote], '').map((a) => a.manifest.id)).toEqual(['com.linvo.cinemeta']);
  });

  it('points local-server add-ons at the PC', () => {
    const out = usableAddons([local, remote], 'http://192.168.1.20:11470');
    expect(out[0].transportUrl).toBe('http://192.168.1.20:11470/local-addon/manifest.json');
    expect(out).toHaveLength(2);
  });
});

describe('streaming server URLs', () => {
  const server = 'http://192.168.1.20:11470';

  it('normalises user input', () => {
    expect(normaliseServerUrl('192.168.1.20')).toBe(server);
    expect(normaliseServerUrl('http://192.168.1.20:11470/')).toBe(server);
    expect(normaliseServerUrl('https://pc.local:12470')).toBe('https://pc.local:12470');
    expect(normaliseServerUrl('  ')).toBe('');
  });

  it('builds torrent URLs like stremio-video createTorrent', () => {
    expect(torrentUrl(server, 'abc', 2, [])).toBe(`${server}/abc/2`);
    expect(torrentUrl(server, 'abc', -1, ['dht:abc', 'tracker:udp://t.example:80'])).toBe(
      `${server}/abc/-1?tr=dht%3Aabc&tr=tracker%3Audp%3A%2F%2Ft.example%3A80`,
    );
  });

  it('builds proxy URLs like stremio-core', () => {
    expect(proxyUrl(server, 'https://cdn.example.com/v/file.mkv?token=1', {Referer: 'https://a.example/'})).toBe(
      `${server}/proxy/d=https%3A%2F%2Fcdn.example.com&h=Referer%3Ahttps%3A%2F%2Fa.example%2F/v/file.mkv?token=1`,
    );
  });

  it('routes subtitles through the server converter', () => {
    expect(subtitleViaServer(server, 'https://subs.example/1.srt')).toBe(`${server}/subtitles.vtt?from=https%3A%2F%2Fsubs.example%2F1.srt`);
  });

  it('parses magnet links', () => {
    const hash = '0123456789abcdef0123456789abcdef01234567';
    expect(parseMagnet(`magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=x&tr=udp%3A%2F%2Ft.example%3A80`)).toEqual({
      infoHash: hash,
      trackers: ['udp://t.example:80'],
    });
    expect(parseMagnet('https://example.com')).toBeNull();
  });

  it('describes streams for the list', () => {
    expect(describeStream({name: 'Add-on\n1080p', title: 'Movie.2024.mkv\n💾 2 GB', infoHash: 'a'})).toEqual({
      title: 'Add-on 1080p · Movie.2024.mkv',
      detail: 'Torrent · 💾 2 GB',
    });
  });
});

describe('library progress', () => {
  it('round-trips an existing item and only changes progress fields', () => {
    const item: LibraryItem = {
      _id: 'tt1',
      name: 'Film',
      type: 'movie',
      removed: false,
      temp: false,
      _mtime: '2025-01-01T00:00:00.000Z',
      state: {timeOffset: 0, duration: 0, timesWatched: 1, video_id: null},
      behaviorHints: {defaultVideoId: null},
    };
    const updated = withProgress(item, 'tt1', 125.4, 5400);
    expect(updated.state.timeOffset).toBe(125400);
    expect(updated.state.duration).toBe(5400000);
    expect(updated.state.video_id).toBe('tt1');
    expect(updated.state.timesWatched).toBe(1);
    expect(updated.name).toBe('Film');
    expect(updated._mtime).not.toBe(item._mtime);
  });
});

describe('subtitles', () => {
  const cues = parseSubtitles('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello\n\n2\n00:00:02.500 --> 00:00:04.000\nWorld\n\n3\n00:00:10,000 --> 00:00:11,000\n<i>Later</i>\n');

  it('finds the cue text showing at a time, including overlaps', () => {
    expect(cueTextAt(cues, 0.5)).toBe('');
    expect(cueTextAt(cues, 1.5)).toBe('Hello');
    expect(cueTextAt(cues, 2.7)).toBe('Hello\nWorld');
    expect(cueTextAt(cues, 5)).toBe('');
    expect(cueTextAt(cues, 10.2)).toBe('Later');
    expect(cueTextAt([], 1)).toBe('');
  });

  it('rejects HTML pages served instead of subtitles', () => {
    expect(looksLikeSubtitles('<html><body>This site is blocked</body></html>')).toBe(false);
    expect(looksLikeSubtitles('1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe(true);
  });
});

import {rankStreams as rankForSpeed} from '../src/stremio/streamPicker';

describe('stream choice fits the measured connection', () => {
  const s = (title: string) => ({url: `https://x/${encodeURIComponent(title)}`, title});
  const streams = [s('Film 2160p WEB-DL HDR10 DDP Atmos x265 💾 12.8 GB .mkv'), s('Film 1080p WEB-DL DDP5.1 x264 💾 4.2 GB .mkv')];

  it('keeps 4K first when the speed is unknown or ample', () => {
    expect(rankForSpeed([{addonName: 'a', streams}], {hasServer: false, runtimeMin: 125})[0].traits.resolution).toBe(2160);
    expect(rankForSpeed([{addonName: 'a', streams}], {hasServer: false, runtimeMin: 125, mkvMbps: 60})[0].traits.resolution).toBe(2160);
  });

  it('prefers a version the connection can carry when it is slow', () => {
    // 12.8 GB over 125 min is about 14.7 Mbit/s; at 12 Mbit/s measured only ~9.6 fits.
    expect(rankForSpeed([{addonName: 'a', streams}], {hasServer: false, runtimeMin: 125, maxMbps: 9.6})[0].traits.resolution).toBe(1080);
  });
});
