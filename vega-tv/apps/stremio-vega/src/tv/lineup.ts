// The curated TV line-up: real UK and US channels only, in a normal TV order,
// each in one category. `keys` are names after parseChannelName() (see
// normalize.ts); a provider entry joins a channel when its key matches and it
// comes from the same country list.

export type Country = 'UK' | 'US';

export interface Category {
  id: string;
  title: string;
}

export interface Channel {
  id: string;
  name: string;
  country: Country;
  category: string;
  keys: string[];
  /** Channel number shown in the guide and banner (our own numbering, stable). */
  number: number;
}

export const CATEGORIES: Category[] = [
  {id: 'uk-ent', title: 'UK Entertainment'},
  {id: 'uk-drama', title: 'UK Drama & Crime'},
  {id: 'uk-sport', title: 'UK Sport'},
  {id: 'uk-films', title: 'UK Films'},
  {id: 'uk-news', title: 'UK News'},
  {id: 'uk-docs', title: 'UK Documentaries'},
  {id: 'us-net', title: 'US Networks'},
  {id: 'us-ent', title: 'US Entertainment & Drama'},
  {id: 'us-sport', title: 'US Sport'},
  {id: 'us-films', title: 'US Films'},
  {id: 'us-news', title: 'US News'},
];

type Row = [id: string, name: string, keys?: string[]];

// First channel number of each category, TV-box style (entertainment 101, films
// 301, sport 401, news 501, US from 601).
const FIRST_NUMBER: Record<string, number> = {
  'uk-ent': 101,
  'uk-drama': 131,
  'uk-docs': 161,
  'uk-films': 301,
  'uk-sport': 401,
  'uk-news': 501,
  'us-net': 601,
  'us-ent': 621,
  'us-sport': 661,
  'us-films': 691,
  'us-news': 711,
};

function rows(country: Country, category: string, list: Row[]): Channel[] {
  return list.map(([id, name, keys], i) => ({
    number: (FIRST_NUMBER[category] || 900) + i,
    id: `${country.toLowerCase()}-${id}`,
    name,
    country,
    category,
    keys: keys && keys.length ? keys : [name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9+]+/g, ' ').trim()],
  }));
}

export const CHANNELS: Channel[] = [
  ...rows('UK', 'uk-ent', [
    ['bbc1', 'BBC One', ['bbc one']],
    ['bbc2', 'BBC Two', ['bbc two']],
    ['itv1', 'ITV1', ['itv1']],
    ['ch4', 'Channel 4', ['channel 4']],
    ['ch5', 'Channel 5', ['channel 5']],
    ['showcase', 'Sky Showcase', ['sky showcase']],
    ['skymax', 'Sky Max', ['sky max']],
    ['itv2', 'ITV2', ['itv2']],
    ['e4', 'E4', ['e4']],
    ['dave', 'Dave', ['dave']],
    ['comedycentral', 'Comedy Central', ['comedy central']],
    ['skycomedy', 'Sky Comedy', ['sky comedy']],
    ['itv4', 'ITV4', ['itv4']],
    ['w', 'W', ['w']],
    ['gold', 'Gold', ['gold']],
    ['itvbe', 'ITV Quiz', ['itv quiz', 'itv be', 'itvbe']],
    ['bbc3', 'BBC Three', ['bbc three', 'bbc 3']],
    ['bbc4', 'BBC Four', ['bbc four', 'bbc 4']],
    ['quest', 'Quest', ['quest']],
    ['really', 'Really', ['really']],
    ['5star', '5STAR', ['5star', '5 star']],
  ]),
  ...rows('UK', 'uk-drama', [
    ['atlantic', 'Sky Atlantic', ['sky atlantic']],
    ['witness', 'Sky Witness', ['sky witness']],
    ['skycrime', 'Sky Crime', ['sky crime']],
    ['itv3', 'ITV3', ['itv3']],
    ['alibi', 'Alibi', ['alibi']],
    ['drama', 'Drama', ['drama']],
    ['5usa', '5USA', ['5usa', '5 usa']],
    ['more4', 'More4', ['more4']],
    ['skyreplay', 'Sky Replay', ['sky replay']],
    ['ci', 'Crime+Investigation', ['crime investigation', 'crime and investigation', 'crime+investigation']],
  ]),
  ...rows('UK', 'uk-sport', [
    ['ss-main', 'Sky Sports Main Event', ['sky sports main event']],
    ['ss-pl', 'Sky Sports Premier League', ['sky sports premier league']],
    ['ss-football', 'Sky Sports Football', ['sky sports football']],
    ['ss-f1', 'Sky Sports F1', ['sky sports f1']],
    ['ss-cricket', 'Sky Sports Cricket', ['sky sports cricket']],
    ['ss-golf', 'Sky Sports Golf', ['sky sports golf']],
    ['ss-action', 'Sky Sports Action', ['sky sports action']],
    ['ss-arena', 'Sky Sports+', ['sky sports+', 'sky sports plus', 'sky sports arena']],
    ['ss-tennis', 'Sky Sports Tennis', ['sky sports tennis']],
    ['ss-nfl', 'Sky Sports NFL', ['sky sports nfl']],
    ['ss-darts', 'Sky Sports Darts', ['sky sports darts']],
    ['ss-mix', 'Sky Sports Mix', ['sky sports mix']],
    ['ss-racing', 'Sky Sports Racing', ['sky sports racing']],
    ['ss-news', 'Sky Sports News', ['sky sports news', 'sky sports news hq']],
    ['tnt1', 'TNT Sports 1', ['tnt sports 1']],
    ['tnt2', 'TNT Sports 2', ['tnt sports 2']],
    ['tnt3', 'TNT Sports 3', ['tnt sports 3']],
    ['tnt4', 'TNT Sports 4', ['tnt sports 4']],
    ['tntultimate', 'TNT Sports Ultimate', ['tnt sports ultimate']],
    ['premier1', 'Premier Sports 1', ['premier sports 1']],
    ['premier2', 'Premier Sports 2', ['premier sports 2']],
    ['laliga', 'LaLiga TV', ['laliga tv', 'la liga tv']],
    ['euro1', 'Eurosport 1', ['eurosport 1']],
    ['euro2', 'Eurosport 2', ['eurosport 2']],
    ['racingtv', 'Racing TV', ['racing tv']],
    ['mutv', 'MUTV', ['mutv']],
    ['lfctv', 'LFCTV', ['lfctv', 'lfc tv']],
  ]),
  ...rows('UK', 'uk-films', [
    ['sc-premiere', 'Sky Cinema Premiere', ['sky cinema premiere', 'sky cinema premier']],
    ['sc-hits', 'Sky Cinema Hits', ['sky cinema hits']],
    ['sc-greats', 'Sky Cinema Greats', ['sky cinema greats']],
    ['sc-action', 'Sky Cinema Action', ['sky cinema action']],
    ['sc-thriller', 'Sky Cinema Thriller', ['sky cinema thriller']],
    ['sc-comedy', 'Sky Cinema Comedy', ['sky cinema comedy']],
    ['sc-drama', 'Sky Cinema Drama', ['sky cinema drama']],
    ['sc-scifi', 'Sky Cinema Sci-Fi & Horror', ['sky cinema sci fi horror', 'sky cinema sci fi and horror', 'sky cinema sci fi']],
    ['sc-family', 'Sky Cinema Family', ['sky cinema family']],
    ['sc-animation', 'Sky Cinema Animation', ['sky cinema animation']],
    ['sc-select', 'Sky Cinema Select', ['sky cinema select']],
    ['film4', 'Film4', ['film4']],
  ]),
  ...rows('UK', 'uk-news', [
    ['bbcnews', 'BBC News', ['bbc news']],
    ['skynews', 'Sky News', ['sky news']],
    ['gbnews', 'GB News', ['gb news']],
    ['cnn', 'CNN International', ['cnn', 'cnn international']],
    ['cnbc', 'CNBC', ['cnbc']],
    ['bloomberg', 'Bloomberg', ['bloomberg']],
    ['aljazeera', 'Al Jazeera English', ['al jazeera english', 'al jazeera']],
  ]),
  ...rows('UK', 'uk-docs', [
    ['skydocs', 'Sky Documentaries', ['sky documentaries']],
    ['skynature', 'Sky Nature', ['sky nature']],
    ['skyhistory', 'Sky History', ['sky history', 'history']],
    ['discovery', 'Discovery', ['discovery']],
    ['natgeo', 'National Geographic', ['nat geo', 'national geographic']],
    ['natgeowild', 'Nat Geo Wild', ['nat geo wild']],
    ['animalplanet', 'Animal Planet', ['animal planet']],
  ]),
  ...rows('US', 'us-net', [
    ['abc', 'ABC', ['abc']],
    ['cbs', 'CBS', ['cbs']],
    ['nbc', 'NBC', ['nbc']],
    ['fox', 'FOX', ['fox']],
    ['cw', 'The CW', ['cw', 'the cw']],
    ['pbs', 'PBS', ['pbs']],
  ]),
  ...rows('US', 'us-ent', [
    ['amc', 'AMC', ['amc']],
    ['fx', 'FX', ['fx']],
    ['fxx', 'FXX', ['fxx']],
    ['usa', 'USA Network', ['usa network']],
    ['tnt', 'TNT', ['tnt']],
    ['tbs', 'TBS', ['tbs']],
    ['paramount', 'Paramount Network', ['paramount network']],
    ['bravo', 'Bravo', ['bravo']],
    ['ae', 'A&E', ['a and e']],
    ['syfy', 'Syfy', ['syfy']],
    ['comedycentral', 'Comedy Central', ['comedy central']],
    ['hallmark', 'Hallmark Channel', ['hallmark', 'hallmark channel']],
    ['lifetime', 'Lifetime', ['lifetime']],
    ['freeform', 'Freeform', ['freeform']],
    ['e', 'E!', ['e', 'e entertainment']],
    ['tlc', 'TLC', ['tlc']],
    ['hgtv', 'HGTV', ['hgtv']],
    ['food', 'Food Network', ['food network']],
    ['discovery', 'Discovery', ['discovery', 'discovery channel']],
    ['history', 'History', ['history', 'history channel']],
    ['natgeo', 'National Geographic', ['national geographic', 'nat geo']],
  ]),
  ...rows('US', 'us-sport', [
    ['espn', 'ESPN', ['espn']],
    ['espn2', 'ESPN2', ['espn2']],
    ['espnu', 'ESPNU', ['espn u', 'espnu']],
    ['espnews', 'ESPNews', ['espn news', 'espnews']],
    ['fs1', 'FS1', ['fs1']],
    ['fs2', 'FS2', ['fs2']],
    ['cbssn', 'CBS Sports Network', ['cbs sports network']],
    ['nflnet', 'NFL Network', ['nfl network']],
    ['redzone', 'NFL RedZone', ['nfl redzone', 'nfl red zone']],
    ['nbatv', 'NBA TV', ['nba tv']],
    ['mlbnet', 'MLB Network', ['mlb network']],
    ['nhlnet', 'NHL Network', ['nhl network']],
    ['golf', 'Golf Channel', ['golf channel', 'golf']],
    ['tennis', 'Tennis Channel', ['tennis channel']],
  ]),
  ...rows('US', 'us-films', [
    ['hbo', 'HBO', ['hbo']],
    ['hbo2', 'HBO 2', ['hbo 2']],
    ['hbosig', 'HBO Signature', ['hbo signature']],
    ['hbocomedy', 'HBO Comedy', ['hbo comedy']],
    ['showtime', 'Showtime', ['showtime', 'showtime east']],
    ['starz', 'Starz', ['starz']],
    ['cinemax', 'Cinemax', ['cinemax']],
    ['tcm', 'TCM', ['tcm', 'turner classic movies']],
  ]),
  ...rows('US', 'us-news', [
    ['cnn', 'CNN', ['cnn']],
    ['foxnews', 'Fox News', ['fox news', 'fox news channel']],
    ['msnbc', 'MSNBC', ['msnbc']],
    ['cnbc', 'CNBC', ['cnbc']],
    ['foxbusiness', 'Fox Business', ['fox business', 'fox business network']],
    ['abcnews', 'ABC News Live', ['abc news live', 'abc news']],
    ['cbsnews', 'CBS News', ['cbs news']],
    ['nbcnewsnow', 'NBC News Now', ['nbc news now']],
    ['bloomberg', 'Bloomberg', ['bloomberg']],
  ]),
];

/** "Fake" or placeholder feeds that should never be offered. */
export const EXCLUDE_NAME = /\b(?:EVENT ONLY|NO EVENT|OFF AIR|TEST|BACKUP ONLY|SOON|COMING)\b/i;

/** Categories that hold loops, replays, VOD or one-off event slots rather than real channels. */
export const EXCLUDE_CATEGORY = /24\/7|24-7|REPLAY|VOD|TIMESHIFT|\+1|RADIO|MUSIC|ADULT|XXX|RELIGI|PPV|EVENT|ASIA|INDIA|PAKISTAN|UKRAINE|LATINO|ESPA|SPANISH|DEPORTES|CARIBBEAN|AFRICA|PLUTO|SAMSUNG|STIRR|XUMO|ROKU|TUBI|CHRISTMAS|HALLOWEEN|FLO|ESPN\+|ESPN PLUS|PACKAGE|NETFLIX|CINEMANIA|SLING|MILB|NCAA|SEC NETWORK|BTN\+|MLB|NHL|NBA|MLS|AT&T|TELEMUNDO|SPECTRUM|HAITI|PLAY KIDZ|BEST ACTORS|METV|BALLY|PEACOCK|HULU|DISNEY|PARAMOUNT\+|NATIONAL LEAGUE|SPFL|SCOTTISH|IRELAND|WC 2026|SKY STORE|BOX OFFICE|ITVX|IPLAYER|DISCOVERY\+|AMAZON|PRIME|DAZN|VIAPLAY|MAX|UEFA|EPL|EFL|CUP GAMES|WORLD SPORTS|TC\+/i;

export const BY_ID: Record<string, Channel> = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));

export function channelIndex(): Map<string, Channel> {
  const map = new Map<string, Channel>();
  for (const channel of CHANNELS) {
    for (const key of channel.keys) {
      map.set(`${channel.country}|${key}`, channel);
    }
  }
  return map;
}
