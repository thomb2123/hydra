import {splitEvent, feedLabel, buildEvents, tierOf} from '../src/tv/events';
import {badgeFor, effectiveFailures, rankSources, Source} from '../src/tv/channels';
import {CHANNELS} from '../src/tv/lineup';

jest.mock('../src/tv/flixnest', () => ({
  play: jest.fn(async (_access: unknown, id: string) => ({url: `https://relay/${id}`, mime: 'application/vnd.apple.mpegurl'})),
  needsSignIn: () => false,
}));
jest.mock('../src/tv/probe', () => ({probeStream: jest.fn()}));
jest.mock('../src/tv/guide', () => ({recordResult: jest.fn(async () => ({}))}));

const src = (id: string, quality = 3, provider = 'p'): Source => ({provider, id, rawName: id, quality, fps60: false, hevc: false, epgId: '', logo: ''});

describe('sport listings read like a TV guide', () => {
  it('splits the match from its competition and drops seasons', () => {
    expect(splitEvent('Spain v England - UEFA Nations League 2026/2027')).toEqual({title: 'Spain v England', competition: 'UEFA Nations League'});
    expect(splitEvent('FA Cup: Peterborough v Reading')).toEqual({title: 'Peterborough v Reading', competition: 'FA Cup'});
    expect(splitEvent('New England Patriots @ Detroit Lions - NFL -National Footbal League - 2026/27')).toEqual({title: 'New England Patriots @ Detroit Lions', competition: 'NFL'});
    expect(splitEvent('Snooker - Kyren Wilson - Jak Jones - Northern Ireland Open - Final')).toEqual({title: 'Kyren Wilson v Jak Jones', competition: 'Northern Ireland Open · Final'});
    expect(splitEvent('European Rugby Champions Cup - Semi-Final: Saracens v Wasps')).toEqual({title: 'Saracens v Wasps', competition: 'European Rugby Champions Cup · Semi-Final'});
  });

  it('names event feeds cleanly', () => {
    expect(feedLabel('|UK| BEIN SPORTS ᴴᴰ EN 1')).toBe('beIN Sports 1');
    expect(feedLabel('UK: BEIN SP⚽RTS 2 ENGLISH ᴿᴬᵂ')).toBe('beIN Sports 2');
  });

  it('puts headline football, UFC and boxing above minor events', () => {
    expect(tierOf('Man Utd v Liverpool - Premier League')).toBe(0);
    expect(tierOf('New England Patriots @ Detroit Lions')).toBe(1);
    expect(tierOf("AFCON Qualifier '27: KEN v RSA")).toBe(2);
  });

  it('drops local news slots, documentaries and filler that providers tag as sport', () => {
    const channels = [{...CHANNELS.find((c) => c.id === 'uk-tnt3')!, sources: [src('a')], logo: '', badge: 'HD' as const}];
    const now = Math.floor(Date.now() / 1000);
    const item = (name: string, sport = 'Football') => ({name, sport, status: 'live', start: now, broadcasts: [{name: 'TNT Sports 3', id: 'p:1'}]});
    const out = buildEvents(
      [
        item('CBS Colorado at 5PM', 'American Football'),
        item('Premier League: The Art of... - The Evolution of the Premier League Goalkeepper'),
        item('FA Cup Football'),
        item('UFC Fight Flashback', 'MMA'),
        item('FA Cup: Peterborough v Reading'),
      ],
      channels,
    );
    expect(out.map((e) => e.title)).toEqual(['Peterborough v Reading']);
  });
});

describe('source ranking learns from this stick', () => {
  it('prefers a source that really played in UHD over a labelled-UHD one that never did', () => {
    const labelled = src('fake4k', 4);
    const real = src('real', 3);
    const rel = {provider: {}, failures: {}, good: {'p|real': Date.now()}, height: {'p|real': 2160}};
    expect(rankSources([labelled, real], rel)[0].id).toBe('real');
    expect(badgeFor([real], rel)).toBe('UHD');
    expect(badgeFor([labelled], {provider: {}, failures: {}})).toBe('HD');
  });

  it('lets old failures fade so a channel off air last night is tried again', () => {
    const rel = {provider: {}, failures: {k: 4}, failedAt: {k: Date.now() - 24 * 3600 * 1000}};
    expect(effectiveFailures(rel, 'k')).toBeCloseTo(1, 1);
  });

  it('numbers channels like a TV box', () => {
    expect(CHANNELS.find((c) => c.id === 'uk-bbc1')!.number).toBe(101);
    expect(new Set(CHANNELS.map((c) => c.number)).size).toBe(CHANNELS.length);
  });
});

describe('tuning', () => {
  const {probeStream} = jest.requireMock('../src/tv/probe');
  const {firstLive} = require('../src/tv/tune');

  it('plays the best-ranked live source and skips placeholders', async () => {
    probeStream.mockImplementation(async (url: string) => ({state: url.endsWith('/a') ? 'placeholder' : 'live'}));
    const found = await firstLive({type: 'account'}, [src('a', 4), src('b', 3), src('c', 3)]);
    expect(found.source.id).toBe('b');
  });

  it('does not let a slow better source hold up the picture for long', async () => {
    probeStream.mockImplementation((url: string) =>
      url.endsWith('/slow') ? new Promise((r) => setTimeout(() => r({state: 'live'}), 2500)) : Promise.resolve({state: 'live'}),
    );
    const t0 = Date.now();
    const found = await firstLive({type: 'account'}, [src('slow', 4), src('quick', 3)]);
    expect(found.source.id).toBe('quick');
    expect(Date.now() - t0).toBeLessThan(2400);
  });

  it('reports nothing when every source is off air', async () => {
    probeStream.mockImplementation(async () => ({state: 'dead'}));
    expect(await firstLive({type: 'account'}, [src('x'), src('y')])).toBeNull();
  });
});
