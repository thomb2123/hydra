// Search over Live TV: channels by name or number, live matches by team or competition.
import {MergedChannel} from './channels';
import {SportEvent} from './events';

const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();

/** Channels whose name contains every typed word (or whose number is typed), best first. */
export function matchChannels(channels: MergedChannel[], text: string, max = 6): MergedChannel[] {
  const q = plain(text);
  if (q.length < 2) {
    return [];
  }
  if (/^\d{3}$/.test(q)) {
    return channels.filter((c) => String(c.number) === q).slice(0, max);
  }
  const words = q.split(' ');
  return channels
    .filter((c) => {
      const name = ` ${plain(c.name)} `;
      return words.every((w) => name.includes(` ${w}`));
    })
    .sort((a, b) => Number(plain(b.name).startsWith(q)) - Number(plain(a.name).startsWith(q)) || Number(a.number) - Number(b.number))
    .slice(0, max);
}

/** Live matches naming the typed words (a team, a fighter, a competition). */
export function matchEvents(events: SportEvent[], text: string, max = 4): SportEvent[] {
  const q = plain(text);
  if (q.length < 3) {
    return [];
  }
  const words = q.split(' ');
  return events
    .filter((e) => {
      const hay = ` ${plain(`${e.title} ${e.competition} ${e.sport}`)} `;
      return words.every((w) => hay.includes(` ${w}`));
    })
    .slice(0, max);
}
