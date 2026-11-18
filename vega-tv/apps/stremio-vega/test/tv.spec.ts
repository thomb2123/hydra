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

import {programmeTag} from '../src/tv/scores';

describe('guide programme tags', () => {
  const now = Math.floor(Date.now() / 1000);
  const board = (state: string, home: string, away: string) => ({
    name: `${away} at ${home}`,
    date: new Date((now - 3600) * 1000).toISOString(),
    status: {type: {state, description: state === 'in' ? 'Second Half' : 'Full Time'}},
    competitions: [{competitors: [{team: {displayName: home}}, {team: {displayName: away}}]}],
  });
  const scores = (...events: any[]): Scores => ({events: parseBoard('Football', {events}), covered: new Set(['Football'])});

  it('marks a match being played as LIVE and a finished one as REPLAY', () => {
    expect(programmeTag('Live: Borussia Dortmund v Bayern Munich', scores(board('in', 'Borussia Dortmund', 'Bayern Munich')), now)).toBe('LIVE');
    expect(programmeTag('Bundesliga: Borussia Dortmund v Bayern Munich', scores(board('post', 'Borussia Dortmund', 'Bayern Munich')), now)).toBe('REPLAY');
  });

  it('marks highlights, classics and old seasons as REPLAY, plain shows as nothing', () => {
    expect(programmeTag('Premier League Years 13/14', null, now)).toBe('REPLAY');
    expect(programmeTag('EFL Highlights', null, now)).toBe('REPLAY');
    expect(programmeTag('Champions Cup · 2021 Semi-Final', null, now)).toBe('REPLAY');
    expect(programmeTag('Sports Desk', null, now)).toBeNull();
    expect(programmeTag('Live 1st Test Day 4', null, now)).toBe('LIVE');
  });
});

describe('official Sky guide', () => {
  const {parseSchedule, pickNowNext, SKY_SID} = require('../src/tv/skyGuide');
  const {sameProgramme, withOfficial, nowTag, displayTitle} = require('../src/tv/epg');
  const {CHANNELS} = require('../src/tv/lineup');
  const sample = {
    schedule: [
      {
        sid: '4002',
        events: [
          {st: 1000, d: 3600, t: 'Live Grand Slam Of Darts', sy: 'Day four of the Grand Slam of Darts.'},
          {st: 4600, d: 3600, t: 'Sky Sports News', sy: 'Round-up of the sports news.'},
          {st: 8200, d: 7200, t: 'Bundesliga: Dortmund v Bayern', sy: 'From Saturday.'},
        ],
      },
    ],
  };

  it('reads titles, synopses, times and Sky live labels', () => {
    const list = parseSchedule(sample);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({title: 'Live Grand Slam Of Darts', start: 1000, end: 4600, live: true, description: 'Day four of the Grand Slam of Darts.'});
    expect(list[1].live).toBe(false);
    expect(pickNowNext(list, 5000).now.title).toBe('Sky Sports News');
    expect(pickNowNext(list, 5000).next.title).toMatch(/Dortmund/);
    expect(pickNowNext(list, 500).now).toBeNull();
  });

  it('maps only channels that exist in the line-up', () => {
    const ids = new Set(CHANNELS.map((c: any) => c.id));
    for (const id of Object.keys(SKY_SID)) {
      expect(ids.has(id)).toBe(true);
    }
    expect(SKY_SID['uk-ss-main']).toBe('4002');
  });

  it('compares listings from different guides', () => {
    expect(sameProgramme('Live Grand Slam Of Darts', 'Grand Slam of Darts: Day 4')).toBe(true);
    expect(sameProgramme('LIVE: Sky Sports News', 'Sky Sports News')).toBe(true);
    expect(sameProgramme('Live Bundesliga: Dortmund v Bayern', 'Sky Sports News')).toBe(false);
  });

  it('prefers the official guide and flags a stream labelled as something else', () => {
    const sky = {now: {title: 'Live Grand Slam Of Darts', start: 1, end: 2, live: true}, next: null};
    const results = [
      {id: 'a', epg: {now: {title: 'Bundesliga: Dortmund v Bayern'}}},
      {id: 'b', epg: {now: {title: 'Grand Slam of Darts'}}},
    ];
    const v = withOfficial({now: {title: 'Bundesliga: Dortmund v Bayern'}, next: null, outliers: []}, sky, results);
    expect(v.official).toBe(true);
    expect(v.now.title).toBe('Live Grand Slam Of Darts');
    expect(v.streamSays).toBe('Bundesliga: Dortmund v Bayern');
    expect(v.outliers).toEqual(['a']);
    expect(withOfficial({now: {title: 'X'}, next: null, outliers: []}, null, results).official).toBeUndefined();
  });

  it('tags live and re-run matches from the official guide', () => {
    const live = {now: {title: 'Live Grand Slam Of Darts', live: true}, outliers: [], official: true};
    const rerun = {now: {title: 'Bundesliga: Dortmund v Bayern', live: false}, outliers: [], official: true};
    const studio = {now: {title: 'Sky Sports News', live: false}, outliers: [], official: true};
    expect(nowTag(live, true)).toBe('LIVE');
    expect(nowTag(rerun, true)).toBe('REPLAY');
    expect(nowTag(studio, true)).toBeNull();
    expect(nowTag(rerun, false)).toBeNull();
    expect(nowTag({now: {title: 'Sao Paulo F1 Grand Prix', live: false}, outliers: [], official: true}, true)).toBe('REPLAY');
    expect(nowTag({now: {title: 'PGA Tour: The Cut', live: false}, outliers: [], official: true}, true)).toBeNull();
    expect(displayTitle(live.now)).toBe('Grand Slam Of Darts');
  });
});

describe('official guides for every channel', () => {
  const og = require('../src/tv/officialGuide');
  const {CHANNELS} = require('../src/tv/lineup');

  it('gives every channel an official guide, or says why there is none', () => {
    const ids = new Set(CHANNELS.map((c: any) => c.id));
    const uncovered = CHANNELS.filter((c: any) => !og.guideFor(c.id) && !og.OFFICIAL_NONE[c.id]).map((c: any) => c.id);
    expect(uncovered).toEqual([]);
    for (const id of [...Object.keys(og.TVGUIDE_ID), ...Object.keys(og.VIRGIN_ID), ...Object.keys(og.OFFICIAL_NONE)]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('reads TV Guide listings with its live flag and descriptions', () => {
    const grid = og.parseTvGuide({
      data: {
        items: [
          {
            channel: {name: 'ESPN', sourceId: 9200006937},
            programSchedules: [
              {airingAttrib: 524289, startTime: 100, endTime: 200, programId: 1, title: 'College Basketball'},
              {airingAttrib: 524304, startTime: 200, endTime: 300, programId: 2, title: 'SportsCenter'},
            ],
          },
        ],
      },
    });
    const espn = grid.get(9200006937);
    expect(espn).toHaveLength(2);
    expect(espn[0]).toMatchObject({title: 'College Basketball', start: 100, end: 200, live: true, programId: 1});
    expect(espn[1].live).toBe(false);
    expect(og.tvGuideDescription({data: {item: {episodeTitle: 'Players Era 8', description: 'From Las Vegas'}}})).toBe('Players Era 8 — From Las Vegas');
  });

  it('reads Virgin Media listings', () => {
    const vm = og.parseVirgin({entries: [{channelId: '1954', events: [{title: 'This is TNT Sports Ultimate', startTime: 10, endTime: 20, isLive: false}]}]});
    expect(vm.get('1954')[0]).toMatchObject({title: 'This is TNT Sports Ultimate', start: 10, end: 20, live: false});
  });
});

describe('channel audit fixes', () => {
  const {rankSources, knownWrong} = require('../src/tv/channels');
  const {agreesWithOfficial} = require('../src/tv/epg');
  const src = (provider: string, rawName: string, quality = 4) => ({provider, id: rawName, rawName, quality, fps60: false, hevc: false, epgId: '', logo: ''});

  it('tries sources caught showing placeholders or other channels last', () => {
    expect(knownWrong(src('dream4k_tv', '|UK| SKY COMEDY ᵁᴴᴰ'))).toBe(true);
    expect(knownWrong(src('streamsports99', 'US| ABC HD'))).toBe(true);
    expect(knownWrong(src('strong_vault_tv', 'US: ABC (EAST)'))).toBe(false);
    const ranked = rankSources([src('streamsports99', 'US| ABC HD', 3), src('strong_vault_tv', 'US: ABC (EAST)', 2)]);
    expect(ranked[0].rawName).toBe('US: ABC (EAST)');
  });

  it('does not flag a stream label that is one programme behind or the series name', () => {
    const official = {now: {title: 'Exeter Women v Saracens Women', description: "Premiership Women's Rugby: Exeter host Saracens."}, prev: {title: 'BBC London News'}, next: null};
    expect(agreesWithOfficial('BBC London News', official)).toBe(true);
    expect(agreesWithOfficial("Premiership Women's Rugby", official)).toBe(true);
    expect(agreesWithOfficial('The Simpsons', official)).toBe(false);
  });

  it('finds a live match in an official listing by both team names', () => {
    const {listingNamesFixture} = require('../src/tv/events');
    expect(listingNamesFixture('Real Madrid v Inter', "UEFA Women's Champions League Soccer Internazionale at Real Madrid from Estadio Santiago Bernabeu")).toBe(true);
    expect(listingNamesFixture('Real Madrid v Inter', "UEFA Women's Champions League Soccer Chelsea at Real Madrid")).toBe(false);
    expect(listingNamesFixture('UFC 320', 'UFC 320 Prelims')).toBe(false);
  });
});

import {msUntilChange} from '../src/tv/epg';

describe('listings move on when the programme ends', () => {
  const t0 = 1_800_000_000_000;
  test('refreshes just after the programme on now ends', () => {
    const info = {now: {title: 'A', start: t0 / 1000 - 600, end: t0 / 1000 + 120}, outliers: []} as any;
    expect(msUntilChange(info, t0)).toBe(140 * 1000);
  });
  test('never waits more than 10 minutes, nor less than 15 seconds', () => {
    expect(msUntilChange({now: {title: 'A', start: 0, end: t0 / 1000 + 7200}, outliers: []} as any, t0)).toBe(600 * 1000);
    expect(msUntilChange({now: {title: 'A', start: 0, end: t0 / 1000 - 60}, outliers: []} as any, t0)).toBe(15 * 1000);
  });
  test('no listing yet: tries again in 3 minutes', () => {
    expect(msUntilChange({now: null, outliers: []} as any, t0)).toBe(180 * 1000);
    expect(msUntilChange(null, t0)).toBe(180 * 1000);
  });
});

import {matchChannels, matchEvents} from '../src/tv/searchMatch';

describe('search finds live TV', () => {
  const ch = (id: string, name: string, number: number, category = 'uk-sport') => ({id, name, number, category, keys: [], country: 'UK', sources: [], logo: '', badge: ''}) as any;
  const channels = [
    ch('uk-ss-main', 'Sky Sports Main Event', 401),
    ch('uk-ss-pl', 'Sky Sports Premier League', 402),
    ch('uk-ss-f1', 'Sky Sports F1', 404),
    ch('uk-skyatl', 'Sky Atlantic', 122, 'uk-drama'),
    ch('uk-bbc1', 'BBC One', 101, 'uk-ent'),
  ];
  test('every typed word must start a word of the name', () => {
    expect(matchChannels(channels, 'sky sports').map((c) => c.number)).toEqual([401, 402, 404]);
    expect(matchChannels(channels, 'sky f1').map((c) => c.number)).toEqual([404]);
    expect(matchChannels(channels, 'ports')).toEqual([]);
  });
  test('a channel number finds that channel', () => {
    expect(matchChannels(channels, '101').map((c) => c.name)).toEqual(['BBC One']);
  });
  test('too short to search', () => {
    expect(matchChannels(channels, 's')).toEqual([]);
  });
  test('a team name finds its live match', () => {
    const events = [{key: 'a', title: 'Arsenal v Chelsea', competition: 'Premier League', sport: 'Football'}, {key: 'b', title: 'Littler v Price', competition: 'Grand Slam of Darts', sport: 'Darts'}] as any;
    expect(matchEvents(events, 'arsenal').map((e: any) => e.key)).toEqual(['a']);
    expect(matchEvents(events, 'darts').map((e: any) => e.key)).toEqual(['b']);
    expect(matchEvents(events, 'ar')).toEqual([]);
  });
});
