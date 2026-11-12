// Openly licensed test media used by the proof of concept.
// Big Buck Bunny and Elephants Dream are Blender Foundation films (CC BY);
// the Matroska files are the official Matroska conformance suite.
import type {PlaySource} from '../../../shared/src/player/VideoScreen';

export interface TestVideo extends PlaySource {
  id: string;
  expectation: string;
}

const MKV = 'https://raw.githubusercontent.com/ietf-wg-cellar/matroska-test-files/master/test_files';

export const TEST_VIDEOS: TestVideo[] = [
  {
    id: 'mp4',
    title: 'MP4 · H.264 + AAC (Big Buck Bunny, 1080p)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    expectation: 'Must play: URL mode, documented format.',
  },
  {
    id: 'mkv-basic',
    title: 'MKV · H.264 + AAC (Matroska test 2)',
    url: `${MKV}/test2.mkv`,
    expectation: 'Must play: MKV is a documented URL-mode container.',
  },
  {
    id: 'mkv-tracks',
    title: 'MKV · 2 audio + 7 subtitle tracks (Matroska test 5)',
    url: `${MKV}/test5.mkv`,
    expectation: 'Plays; press ▲ to check audio and embedded subtitle switching.',
  },
  {
    id: 'mkv-subs-external',
    title: 'MKV + external SRT parsed by the app',
    url: `${MKV}/test2.mkv`,
    subtitles: [
      {
        id: 'demo-srt',
        label: 'English (external SRT demo)',
        language: 'en',
        url: 'https://raw.githubusercontent.com/thomb2123/hydra/claude/stremio-flixnest-fire-tv-2k4hzj/vega-tv/apps/vega-poc/test-media/demo.srt',
      },
      {
        id: 'inline-srt',
        label: 'English (built into app, no download)',
        language: 'en',
        url: '',
        text: '1\n00:00:01,000 --> 00:00:08,000\nInline subtitle: parsing and rendering work.\n\n2\n00:00:09,000 --> 00:00:30,000\nIf you see this, VTTCue rendering works.\n',
      },
    ],
    expectation: 'Press ▲ and choose the external subtitle; text should appear in the first minute.',
  },
  {
    id: 'ts',
    title: 'MPEG-TS segment · H.264 + AAC (IPTV-style container)',
    url: 'https://test-streams.mux.dev/x36xhzz/url_6/url_846/193039199_mp4_h264_aac_hq_7.ts',
    expectation: 'Should play 10 s: this is the container Xtream live channels use.',
  },
  {
    id: 'hls-url-mode',
    title: 'HLS manifest in URL mode (expected to FAIL)',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    expectation: 'Amazon documents this as unsupported without Shaka; confirms whether MSE is required.',
  },
  {
    id: 'mkv-theora',
    title: 'MKV · Theora + Vorbis, live-style (Matroska test 4)',
    url: `${MKV}/test4.mkv`,
    expectation: 'Edge case: software-decoded codec and unknown-size segments.',
  },
];

export const PROBE_TYPES: string[] = [
  'video/mp4; codecs="avc1.640028"',
  'video/mp4; codecs="hvc1.1.6.L150.B0"',
  'video/mp4; codecs="hev1.2.4.L153.B0"',
  'video/mp4; codecs="av01.0.08M.08"',
  'video/webm; codecs="vp9"',
  'video/webm; codecs="vp09.02.10.10"',
  'video/x-matroska',
  'video/mp2t',
  'video/x-msvideo',
  'video/quicktime',
  'application/vnd.apple.mpegurl',
  'application/x-mpegURL',
  'application/dash+xml',
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/mp4; codecs="mp4a.40.5"',
  'audio/mp4; codecs="ac-3"',
  'audio/mp4; codecs="ec-3"',
  'audio/ac3',
  'audio/eac3',
  'audio/mp4; codecs="dtsc"',
  'audio/webm; codecs="opus"',
  'audio/flac',
  'audio/mpeg',
];
