// Node built-ins (the app's tsconfig has no Node types).
declare const require: (m: string) => any;
declare const process: {env: Record<string, string | undefined>};
declare const Buffer: any;
const fs = require('fs');
import {readVint, readSignedVint} from '../src/mkv/ebml';
import {findNextCluster, parseCluster, parseHead} from '../src/mkv/matroska';
import {MkvRemuxer, chooseAudioTrack, chooseVideoTrack} from '../src/mkv/remux';
import {hevcCodecString} from '../src/mkv/codecs';

describe('ebml', () => {
  it('reads vints, unknown sizes and signed lacing deltas', () => {
    expect(readVint(new Uint8Array([0x81]), 0)).toEqual({value: 1, length: 1});
    expect(readVint(new Uint8Array([0x40, 0x02]), 0)).toEqual({value: 2, length: 2});
    expect(readVint(new Uint8Array([0xff]), 0)?.value).toBe(-1);
    expect(readSignedVint(new Uint8Array([0xbf]), 0)?.value).toBe(0);
    expect(readSignedVint(new Uint8Array([0x80]), 0)?.value).toBe(-63);
  });

  it('builds RFC 6381 HEVC codec strings', () => {
    const hvcC = new Uint8Array(23);
    hvcC[1] = 0x02; // Main 10
    hvcC[2] = 0x20; // compat flag for profile 2 (bit 2 from the left)
    hvcC[6] = 0xb0;
    hvcC[12] = 153;
    expect(hevcCodecString(hvcC)).toBe('hvc1.2.4.L153.B0');
  });
});

// Real-file check: set MKV_SAMPLE to the first megabytes of an MKV and MKV_OUT to a folder.
const sample = process.env.MKV_SAMPLE;
const outDir = process.env.MKV_OUT;
(sample && fs.existsSync(sample) ? describe : describe.skip)('real MKV sample', () => {
  it('parses and remuxes clusters to fragmented MP4', () => {
    const buf = new Uint8Array(fs.readFileSync(sample as string));
    const head = parseHead(buf);
    expect(head).not.toBeNull();
    const info = head!;
    const video = chooseVideoTrack(info.tracks);
    const audio = chooseAudioTrack(info.tracks);
    // eslint-disable-next-line no-console
    console.log('duration', info.duration.toFixed(1), 'cues at', info.cuesOffset, 'tracks', info.tracks.map((t) => `${t.number}:${t.kind}:${t.codecId}:${t.language}`).join(' '));
    expect(video).not.toBeNull();
    const remux = new MkvRemuxer(video, audio);
    const wanted = new Set<number>([video!.number, ...(audio ? [audio.number] : [])]);
    let pos = info.firstClusterOffset ?? findNextCluster(buf, 0);
    const vParts: Uint8Array[] = [];
    const aParts: Uint8Array[] = [];
    let clusters = 0;
    let firstPts = -1;
    let lastEnd = 0;
    while (pos >= 0 && pos < buf.length) {
      const cluster = parseCluster(buf, pos, 0, info.timecodeScale, wanted);
      if (!cluster) {
        break;
      }
      if (!remux.audio) {
        const prepared = remux.prepareAudio(cluster.frames);
        if (prepared) {
          aParts.push(prepared.init);
        }
      }
      if (!vParts.length && remux.video) {
        vParts.push(remux.video.init);
      }
      const seg = remux.fragment(cluster.frames);
      if (seg.video) {
        vParts.push(seg.video);
        if (firstPts < 0) {
          firstPts = seg.start as number;
        }
        lastEnd = seg.end as number;
      }
      if (seg.audio) {
        aParts.push(seg.audio);
      }
      clusters++;
      pos = cluster.end;
    }
    // eslint-disable-next-line no-console
    console.log('clusters', clusters, 'video', remux.video?.config.mime, remux.video?.config.label, 'audio', remux.audio?.config.mime, remux.audio?.config.label, 'span', firstPts.toFixed(2), '->', lastEnd.toFixed(2));
    expect(clusters).toBeGreaterThan(0);
    expect(remux.audio).not.toBeNull();
    if (outDir) {
      const join = (parts: Uint8Array[]) => Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
      fs.writeFileSync(`${outDir}/video.mp4`, join(vParts));
      fs.writeFileSync(`${outDir}/audio.mp4`, join(aParts));
    }
  });
});

describe('mkv buffering', () => {
  const {bufferedEndAt, nextRangeAfter, trimPoint} = require('../src/mkv/session');
  const ranges = [
    {start: 0, end: 10},
    {start: 10.6, end: 30},
  ];

  it('finds how far playback can run and the gap after it', () => {
    expect(bufferedEndAt(ranges, 4)).toBe(10);
    expect(nextRangeAfter(ranges, 10)).toBe(10.6);
    expect(nextRangeAfter(ranges, 31)).toBeNull();
  });

  it('only trims at keyframe boundaries behind playback', () => {
    const appended = [
      {start: 0, end: 4, bytes: 1, key: true},
      {start: 4, end: 8, bytes: 1, key: false},
      {start: 8, end: 12, bytes: 1, key: true},
      {start: 12, end: 16, bytes: 1, key: true},
    ];
    expect(trimPoint(appended, 11)).toBe(8);
    expect(trimPoint(appended, 7)).toBe(0);
  });
});
