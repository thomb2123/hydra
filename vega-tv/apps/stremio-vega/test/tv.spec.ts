import {parseChannelName} from '../src/tv/normalize';
import {collectSources, mergeChannels, rankSources} from '../src/tv/channels';
import {buildEvents} from '../src/tv/events';
import {pickConsensus, cleanTitle} from '../src/tv/epg';

describe('parseChannelName', () => {
  it('cleans provider decorations into one key per channel', () => {
    const variants = [
      '|UK| Sky Sports Main Events ᵁᴴᴰ',
      'UK - SKY SPORTS MAIN EVENTS UHD',
      'UK: SKY SPORTS MAIN EVENTS ᴴᴰ',
      'UK-NOWTV| SKY SPORTS MAIN EVENT FHD',
      'UK| SKY SPORTS MAIN EVENTS HEVC FHD',
    ];
    expect(new Set(variants.map((v) => parseChannelName(v).key))).toEqual(new Set(['sky sports main event']));
  });

  it('reads quality tags, including superscript ones', () => {
    expect(parseChannelName('|UK| TNT SPORTS 1 ᵁᴴᴰ 50FPS')).toMatchObject({key: 'tnt sports 1', quality: 4, fps60: true});
    expect(parseChannelName('VIP: SKY SPORTS ACTION ᴿᴬᵂ ʰᵉᵛᶜ')).toMatchObject({key: 'sky sports action', quality: 3, hevc: true});
    expect(parseChannelName('UK| CNBC').quality).toBe(2);
    expect(parseChannelName('8K: beIN SP⚽RTS 8 LQ').quality).toBe(1);
  });

  it('flags timeshift copies and maps spelling variants', () => {
    expect(parseChannelName('UK| ITV +1 LONDON').timeshift).toBe(true);
    expect(parseChannelName('UK| BBC 1').key).toBe('bbc one');
    expect(parseChannelName('UK| ITV 2').key).toBe('itv2');
    expect(parseChannelName('UK| GOLD HEVC FHD').key).toBe('gold');
    expect(parseChannelName('UK| AL JAZEERA EN HD').key).toBe('al jazeera english');
    expect(parseChannelName('US| FOX SPORTS 1 HD').key).toBe('fs1');
  });
});

describe('merging', () => {
  const lists = [
    {provider: 'a', country: 'UK' as const, entries: [
      {id: 'a:1', name: 'UK| SKY SPORTS PREMIER LEAGUE HD', category: 'A: UK| SPORTS'},
      {id: 'a:2', name: 'UK| SKY SPORTS PREMIER LEAGUE +1', category: 'A: UK| SPORTS'},
      {id: 'a:3', name: 'UK| SKY SPORTS PREMIER LEAGUE UHD', category: 'A: UK| 24/7 MOVIES'},
      {id: 'a:4', name: 'UK| BBC ONE WALES', category: 'A: UK| GENERAL'},
    ]},
    {provider: 'b', country: 'UK' as const, entries: [
      {id: 'b:1', name: '|UK| Sky Sports Premier League ᵁᴴᴰ', category: 'B: |UK| ✪ SPORTS', epg_id: '9'},
      {id: 'b:2', name: 'US: FOX UHD/4K+ (EVENT ONLY)', category: 'B: US| SPORT'},
    ]},
  ];

  it('keeps one channel with ranked sources and drops +1, loops, regions and placeholders', () => {
    const merged = mergeChannels(collectSources(lists));
    expect(merged.map((m) => m.id)).toEqual(['uk-ss-pl']);
    expect(merged[0].sources.map((s) => s.id)).toEqual(['b:1', 'a:1']);
  });

  it('demotes sources that keep failing on this stick', () => {
    const sources = collectSources(lists).get('uk-ss-pl')!;
    const ranked = rankSources(sources, {provider: {}, failures: {'b|b:1': 3}});
    expect(ranked[0].id).toBe('a:1');
  });
});

describe('sport events', () => {
  const channels = mergeChannels(
    collectSources([{provider: 'a', country: 'UK', entries: [{id: 'a:9', name: 'UK| TNT SPORTS 3 FHD', category: 'A: UK| SPORTS'}]}]),
  );
  const now = Date.now() / 1000;
  const raw = [
    {name: 'FA Cup: Altrincham v Notts County', sport: 'soccer', status: 'live', start: now - 600, broadcasts: [{id: 'x:1', name: 'UK: TNT SPORTS 3 HD · Strong8K'}]},
    {name: 'Next Event: Brentford v Everton at 08:00PM on Nov 23', sport: 'soccer', status: 'live', start: now, broadcasts: [{id: 'x:2', name: 'UK: EPL EVERTON'}]},
    {name: 'Beachfront Bargain Hunt', sport: 'golf', status: 'live', start: now, broadcasts: [{id: 'x:3', name: 'US: DIY HD'}]},
    {name: 'Fußball: Copa Libertadores - Flamengo vs. Estudiantes', sport: 'soccer', status: 'live', start: now, broadcasts: [{id: 'x:4', name: 'DE: SPORTDIGITAL'}]},
    {name: 'UFC Fight Night: Smith v Jones', sport: 'mma', status: 'upcoming', start: now + 3600, broadcasts: [{id: 'x:5', name: 'UK| DAZN PPV 3 · Trex'}]},
  ];

  it('keeps real English fixtures on UK/US sport channels only', () => {
    const events = buildEvents(raw, channels);
    expect(events.map((e) => `${e.title} | ${e.competition}`)).toEqual(['Altrincham v Notts County | FA Cup', 'Smith v Jones | UFC Fight Night']);
    expect(events[0].channelId).toBe('uk-tnt3');
    expect(events[1].feeds.map((f) => f.id)).toEqual(['x:5']);
  });
});

describe('guide consensus', () => {
  it('uses the majority programme when providers disagree', () => {
    const pick = pickConsensus([
      {id: '1', epg: {now: {title: 'Sky Sports News'}}},
      {id: '2', epg: {now: {title: 'Live Premier League: Arsenal v Chelsea'}}},
      {id: '3', epg: {now: {title: 'Live Premier League: Arsenal v Chelsea (HD)'}}},
    ]);
    expect(cleanTitle(pick.now?.title)).toBe('Live Premier League: Arsenal v Chelsea');
    expect(pick.outliers).toEqual(['1']);
  });
});

import {classifyMediaPlaylist} from '../src/tv/probe';

describe('stream probe', () => {
  const placeholder = (file: string) => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-TARGETDURATION:11\n#EXTINF:15.0,\nhttp://10.0.0.1/video/${file}\n#EXT-X-ENDLIST\n`;
  it('recognises the providers’ maintenance and black-screen placeholders', () => {
    expect(classifyMediaPlaylist(placeholder('Maintenance2024.mp4')).state).toBe('placeholder');
    expect(classifyMediaPlaylist(placeholder('black.ts')).state).toBe('placeholder');
  });
  it('accepts a real live playlist and rejects empty ones', () => {
    const live = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1264\n#EXT-X-TARGETDURATION:12\n#EXTINF:11.52,\nhttp://10.0.0.2:80/hls/abc/577997_1264.ts\n#EXTINF:9.6,\nhttp://10.0.0.2:80/hls/def/577997_1265.ts\n';
    expect(classifyMediaPlaylist(live).state).toBe('live');
    expect(classifyMediaPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:10\n').state).toBe('dead');
    expect(classifyMediaPlaylist('<html>error</html>').state).toBe('dead');
  });
});

import {guideAgrees, isOnNow, liveNow} from '../src/tv/events';

describe('live now is judged by the clock', () => {
  const channels = mergeChannels(
    collectSources([{provider: 'a', country: 'UK', entries: [{id: 'a:9', name: 'UK| TNT SPORTS 3 FHD', category: 'A: UK| SPORTS'}]}]),
  );
  const now = Math.floor(Date.now() / 1000);
  const ev = (name: string, sport: string, status: string, start: number, extra: Record<string, unknown> = {}) => ({
    name,
    sport,
    status,
    start,
    broadcasts: [{id: `x:${name}`, name: 'UK: TNT SPORTS 3 HD · Strong8K'}],
    ...extra,
  });

  it("drops yesterday's match that the feed still marks live", () => {
    const out = buildEvents([ev('Wales v Portugal - UEFA Nations League', 'soccer', 'live', now - 20 * 3600)], channels);
    expect(out).toEqual([]);
  });

  it('drops a football match three hours after kick-off, keeps one at 90 minutes', () => {
    expect(buildEvents([ev('Wales v Portugal', 'soccer', 'live', now - 3 * 3600)], channels)).toEqual([]);
    const on = buildEvents([ev('Wales v Portugal', 'soccer', 'live', now - 90 * 60)], channels);
    expect(liveNow(on, now).map((e) => e.title)).toEqual(['Wales v Portugal']);
  });

  it('keeps a long UFC card running, uses the feed end time when it has one', () => {
    const card = buildEvents([ev('UFC 330: Smith v Jones', 'mma', 'live', now - 4 * 3600)], channels);
    expect(liveNow(card, now)).toHaveLength(1);
    const ended = buildEvents([ev('England v Spain', 'soccer', 'live', now - 3600, {end: now - 600})], channels);
    expect(ended).toEqual([]);
  });

  it('treats a "live" slot hours away as upcoming, and a started "upcoming" one as live', () => {
    const early = buildEvents([ev('Arsenal v Chelsea', 'soccer', 'live', now + 2 * 3600)], channels);
    expect(early[0].live).toBe(false);
    expect(liveNow(early, now)).toEqual([]);
    const late = buildEvents([ev('Arsenal v Chelsea', 'soccer', 'upcoming', now - 20 * 60)], channels);
    expect(liveNow(late, now).map((e) => e.title)).toEqual(['Arsenal v Chelsea']);
  });

  it('drops finished statuses and lets events expire as time passes', () => {
    expect(buildEvents([ev('Arsenal v Chelsea', 'soccer', 'finished', now - 30 * 60)], channels)).toEqual([]);
    const on = buildEvents([ev('Arsenal v Chelsea', 'soccer', 'live', now - 30 * 60)], channels);
    expect(isOnNow(on[0], now)).toBe(true);
    expect(isOnNow(on[0], now + 3 * 3600)).toBe(false);
  });

  it("checks the channel's own guide for right now", () => {
    const event = {title: 'Wales v Portugal', competition: 'UEFA Nations League', sport: 'Football'};
    const slot = (title: string) => ({title, start: now - 1800, end: now + 1800});
    expect(guideAgrees(event, slot('Live: Wales v Portugal'), now)).toBe('match');
    expect(guideAgrees(event, slot('Live International Football'), now)).toBe('unknown');
    expect(guideAgrees(event, slot('Wales v Portugal Highlights'), now)).toBe('other');
    expect(guideAgrees(event, slot('Bargain Hunt'), now)).toBe('other');
    expect(guideAgrees(event, null, now)).toBe('unknown');
  });
});

import {applyScores, looksLikeReplay, parseBoard, Scores} from '../src/tv/scores';

describe('live now: 15 minutes before kick-off, and checked against live scores', () => {
  const channels = mergeChannels(
    collectSources([{provider: 'a', country: 'UK', entries: [{id: 'a:9', name: 'UK| TNT SPORTS 3 FHD', category: 'A: UK| SPORTS'}]}]),
  );
  const now = Math.floor(Date.now() / 1000);
  const ev = (name: string, sport: string, status: string, start: number, end?: number) => ({
    name,
    sport,
    status,
    start,
    end,
    broadcasts: [{id: `x:${name}`, name: 'UK: TNT SPORTS 3 HD · Strong8K'}],
  });
  const board = (state: string, home: string, away: string, start: number) => ({
    name: `${away} at ${home}`,
    date: new Date(start * 1000).toISOString(),
    status: {type: {state}},
    competitions: [{competitors: [{team: {displayName: home}}, {team: {displayName: away}}]}],
  });
  const scoresOf = (...events: any[]): Scores => ({events: parseBoard('Football', {events}), covered: new Set(['Football'])});

  it('shows a match from 15 minutes before kick-off, not an hour before', () => {
    const inTen = buildEvents([ev('Manchester United v Arsenal', 'soccer', 'upcoming', now + 600)], channels);
    expect(liveNow(inTen, now).map((e) => e.title)).toEqual(['Manchester United v Arsenal']);
    expect(liveNow(inTen, now)[0].live).toBe(false);
    const inHour = buildEvents([ev('Manchester United v Arsenal', 'soccer', 'upcoming', now + 3600)], channels);
    expect(liveNow(inHour, now)).toEqual([]);
  });

  it("drops re-runs of last night's match that the listings call live", () => {
    const listed = buildEvents([ev('Wales vs Portugal - UEFA Nations League 2026/2027 - MD6', 'soccer', 'live', now - 1800, now + 1800)], channels);
    expect(listed).toHaveLength(1);
    const scores = scoresOf(board('post', 'Wales', 'Portugal', now - 19 * 3600));
    expect(applyScores(listed, scores, now)).toEqual([]);
  });

  it('keeps a match the scores say is in progress, and marks it confirmed', () => {
    const listed = buildEvents([ev('Man Utd v Arsenal', 'soccer', 'live', now - 1800)], channels);
    const out = applyScores(listed, scoresOf(board('in', 'Manchester United', 'Arsenal', now - 1800)), now);
    expect(out.map((e) => [e.title, e.verified])).toEqual([['Man Utd v Arsenal', true]]);
  });

  it('waits for the real kick-off when the scores say it has not started', () => {
    const listed = buildEvents([ev('Chelsea v Spurs', 'soccer', 'live', now)], channels);
    const out = applyScores(listed, scoresOf(board('pre', 'Chelsea', 'Tottenham Hotspur', now + 3600)), now);
    expect(out[0].live).toBe(false);
    expect(liveNow(out, now)).toEqual([]);
    expect(liveNow(out, now + 3600 - 600)).toHaveLength(1);
  });

  it('drops football the scores do not know today, keeps sports they do not cover', () => {
    // (Separate builds: one channel carries one live event.)
    const listed = [
      ...buildEvents([ev('Juventus v Atalanta - Serie A', 'soccer', 'live', now - 1800)], channels),
      ...buildEvents([ev('Joshua v Fury', 'boxing', 'live', now - 1800)], channels),
    ];
    expect(applyScores(listed, scoresOf(), now).map((e) => e.title)).toEqual(['Joshua v Fury']);
    // Scores unreachable: the listing is all there is.
    expect(applyScores(listed, null, now)).toHaveLength(2);
  });

  it('spots re-runs without scores: an old year, or a highlights-length slot', () => {
    const base = {sport: 'Rugby', start: now - 600, end: now + 6000};
    expect(looksLikeReplay({...base, title: 'La Rochelle v Leinster', competition: 'Champions Cup · 2021 Semi-Final'}, now)).toBe(true);
    expect(looksLikeReplay({...base, title: 'Espanyol v Deportivo', competition: 'LALIGA 2026/2027 MD12'}, now)).toBe(false);
    expect(looksLikeReplay({sport: 'Football', title: 'Wales v Portugal', competition: '', start: now - 600, end: now + 1200}, now)).toBe(true);
  });
});

import {parseHeader} from '../src/tv/scores';

describe('live now: matches with no play going on', () => {
  const channels = mergeChannels(
    collectSources([{provider: 'a', country: 'UK', entries: [{id: 'a:9', name: 'UK| TNT SPORTS 3 FHD', category: 'A: UK| SPORTS'}]}]),
  );
  const now = Math.floor(Date.now() / 1000);
  const listed = buildEvents(
    [{name: 'SA v BAN - 1st Test Day 4', sport: 'cricket', status: 'live', start: now - 7 * 3600, end: now + 1800, broadcasts: [{id: 'x:1', name: 'UK: TNT SPORTS 3 HD · Strong8K'}]}],
    channels,
  );
  const header = (description: string) => ({
    sports: [{leagues: [{events: [{name: 'South Africa v Bangladesh', date: new Date((now - 3 * 86400) * 1000).toISOString(), fullStatus: {type: {state: 'in', description}},
      competitors: [{displayName: 'South Africa', name: 'SA', abbreviation: 'SA'}, {displayName: 'Bangladesh', name: 'BAN', abbreviation: 'BAN'}]}]}]}],
  });

  it('drops a Test at stumps (the channel shows other programmes), keeps it while play is on', () => {
    expect(listed).toHaveLength(1);
    const stumps: Scores = {events: parseHeader('Cricket', header('Stumps')), covered: new Set(['Cricket'])};
    expect(applyScores(listed, stumps, now)).toEqual([]);
    const playing: Scores = {events: parseHeader('Cricket', header('Live')), covered: new Set(['Cricket'])};
    expect(applyScores(listed, playing, now).map((e) => e.verified)).toEqual([true]);
  });
});
