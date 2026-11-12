import {parseSubtitles, parseTimestamp} from '../src/subtitles';

describe('parseTimestamp', () => {
  it('parses SRT and VTT timestamps', () => {
    expect(parseTimestamp('00:01:02,500')).toBeCloseTo(62.5);
    expect(parseTimestamp('01:02.250')).toBeCloseTo(62.25);
    expect(parseTimestamp('1:00:00.000')).toBe(3600);
  });
});

describe('parseSubtitles', () => {
  it('parses SRT with CRLF, BOM and tags', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> &amp; welcome\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nLine one\r\nLine two\r\n';
    expect(parseSubtitles(srt)).toEqual([
      {start: 1, end: 2.5, text: 'Hello & welcome'},
      {start: 3, end: 4, text: 'Line one\nLine two'},
    ]);
  });

  it('parses WebVTT with header, identifiers, settings and notes', () => {
    const vtt = 'WEBVTT\n\nNOTE a comment\n\nintro\n00:00.500 --> 00:02.000 align:start position:10%\n<v Roger>Hi there\n\n00:00:03.000 --> 00:00:05.000\nSecond';
    expect(parseSubtitles(vtt)).toEqual([
      {start: 0.5, end: 2, text: 'Hi there'},
      {start: 3, end: 5, text: 'Second'},
    ]);
  });

  it('skips malformed and empty cues', () => {
    const bad = '1\n00:00:05,000 --> 00:00:04,000\nbackwards\n\n2\nnot a timing\ntext\n\n3\n00:00:06,000 --> 00:00:07,000\n\n';
    expect(parseSubtitles(bad)).toEqual([]);
  });
});
