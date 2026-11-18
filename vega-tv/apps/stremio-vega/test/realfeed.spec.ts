// Real-feed check: set FX_EVENTS to a saved FlixNest events response (needs network for scores).
declare const require: (m: string) => any;
declare const process: {env: Record<string, string | undefined>};
declare const fetch: any;
import {buildEvents, liveNow} from '../src/tv/events';
import {applyScores, parseBoard, parseHeader, Scores} from '../src/tv/scores';
import {Source} from '../src/tv/channels';
import {CHANNELS} from '../src/tv/lineup';

const file = process.env.FX_EVENTS;
const fs = require('fs');
(file && fs.existsSync(file) ? describe : describe.skip)('real FlixNest events', () => {
  it('lists what Live Now would show', async () => {
    const raw = JSON.parse(fs.readFileSync(file as string, 'utf8')).items;
    const src = (id: string): Source => ({provider: 'p', id, rawName: id, quality: 3, fps60: false, hevc: false, epgId: '', logo: ''});
    const channels = CHANNELS.map((c) => ({...c, sources: [src(c.id)], logo: '', badge: 'HD' as const}));
    const now = Date.now() / 1000;
    const ymd = (t: number) => new Date(t * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const boards: [string, string][] = [
      ['Football', `soccer/all/scoreboard?dates=${ymd(now)}`],
      ...[1, 2, 3, 4].map((d): [string, string] => ['Football', `soccer/all/scoreboard?dates=${ymd(now - d * 86400)}`]),
      ['Basketball', 'basketball/nba/scoreboard'],
      ['NFL', 'football/nfl/scoreboard'],
      ['UFC & MMA', 'mma/ufc/scoreboard'],
      ['Formula 1', 'racing/f1/scoreboard'],
      ['Tennis', 'tennis/atp/scoreboard'],
      ['Cricket', 'HEADER cricket'],
      ['Rugby', 'HEADER rugby'],
    ];
    const scores: Scores = {events: [], covered: new Set()};
    for (const [sport, path] of boards) {
      const isHeader = path.startsWith("HEADER ");
      const url = isHeader ? `https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=${path.slice(7)}&lang=en&region=gb` : `https://site.api.espn.com/apis/site/v2/sports/${path}`;
      const data = await (await fetch(url)).json();
      scores.events.push(...(isHeader ? parseHeader(sport, data) : parseBoard(sport, data)));
      scores.covered.add(sport);
    }
    const fmt = (s: number) => new Date(s * 1000).toISOString().slice(11, 16);
    const built = buildEvents(raw, channels, 3 * 3600, now);
    const before = liveNow(built, now);
    const after = liveNow(applyScores(built, scores, now), now);
    const line = (e: any) => `${e.live ? 'LIVE' : 'SOON'} ${fmt(e.start)} t${e.tier} ${e.sport} | ${e.title} | ${e.competition} | ${e.channelName}${e.verified ? ' ✓' : ''}`;
    // eslint-disable-next-line no-console
    console.log(`now ${fmt(now)} UTC; ${scores.events.length} score entries\nBEFORE scores: ${before.length}\nAFTER scores: ${after.length}\n${after.map(line).join('\n')}`);
  }, 60000);
});
