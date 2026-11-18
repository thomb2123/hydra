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
    expect(events.map((e) => e.title)).toEqual(['FA Cup: Altrincham v Notts County', 'UFC Fight Night: Smith v Jones']);
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
