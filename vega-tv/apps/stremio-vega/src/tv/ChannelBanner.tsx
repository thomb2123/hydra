// The now/next banner along the bottom of the picture, like a satellite box:
// channel number and logo, what's on (time, title, progress) and what's next.
// Shown while a channel tunes, for a few seconds after it starts, and on OK.
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {brand, type} from '../ui/brand';
import {ChannelLogo} from '../ui/ChannelLogo';
import {NowNext, displayTitle, nowTag, progressOf, timeRange} from './epg';
import {guideLabel} from './officialGuide';

export interface BannerProps {
  number?: number;
  name: string;
  logo?: string;
  badge?: string;
  info?: NowNext | null;
  /** Shown when there is no guide entry (e.g. the match a sport feed is showing). */
  fallbackTitle?: string;
  /** Small status line, e.g. "Tuning…". */
  status?: string;
  /** A sports channel (a match the official guide does not list as live is a re-run). */
  sport?: boolean;
  /** Remote hints along the bottom (e.g. "OK  Channels"). */
  hint?: string;
}

export const ChannelBanner = ({number, name, logo, badge, info, fallbackTitle, status, sport, hint}: BannerProps) => {
  const now = info?.now;
  const next = info?.next;
  const nowTitle = now?.title ? displayTitle(now) : fallbackTitle || '';
  const tag = nowTag(info, !!sport);
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.shade} />
      <View style={styles.bar}>
        <View style={styles.idCol}>
          {number ? <Text style={styles.number}>{number}</Text> : null}
          <View style={styles.logoBox}>
            <ChannelLogo uri={logo} name={name} style={styles.logo} textStyle={styles.logoText} />
          </View>
        </View>
        <View style={styles.main}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {badge ? <Text style={styles.badge}>{badge}</Text> : null}
            <View style={styles.flex} />
            {status ? <Text style={styles.status}>{status}</Text> : <Text style={styles.live}>● LIVE</Text>}
          </View>
          <Text style={styles.nowLine} numberOfLines={1}>
            {now?.title ? <Text style={styles.time}>{`${timeRange(now)}   `}</Text> : null}
            {tag ? <Text style={tag === 'LIVE' ? styles.tagLive : styles.tagReplay}>{tag === 'LIVE' ? 'LIVE  ' : 'REPLAY  '}</Text> : null}
            {nowTitle || 'No listings available'}
          </Text>
          {now?.start ? (
            <View style={styles.track}>
              <View style={[styles.fill, {width: `${Math.round(progressOf(now) * 100)}%`}]} />
            </View>
          ) : null}
          {now?.description ? (
            <Text style={styles.desc} numberOfLines={2}>
              {now.description}
            </Text>
          ) : null}
          {info?.streamSays ? (
            <Text style={styles.warn} numberOfLines={1}>
              {`${guideLabel(info.guide)} says this; the stream is labelled "${info.streamSays}". If the picture differs, press ☰ for Sources.`}
            </Text>
          ) : info && !info.official && info.noGuide ? (
            <Text style={styles.warn} numberOfLines={1}>
              {`Not in a TV guide: ${info.noGuide.charAt(0).toLowerCase()}${info.noGuide.slice(1)}.`}
            </Text>
          ) : null}
          {next?.title ? (
            <Text style={styles.next} numberOfLines={1}>
              <Text style={styles.nextLabel}>Next   </Text>
              {`${timeRange(next).split('–')[0]}   ${displayTitle(next)}`}
            </Text>
          ) : null}
          {hint ? (
            <Text style={styles.hint} numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  hint: {color: brand.textMuted, fontSize: type.tiny, marginTop: 10},
  wrap: {position: 'absolute', left: 0, right: 0, bottom: 0, height: 420, justifyContent: 'flex-end'},
  shade: {position: 'absolute', left: 0, right: 0, bottom: 0, height: 420, backgroundColor: 'rgba(0,0,0,0.72)'},
  bar: {flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 96, paddingBottom: 64, paddingTop: 36},
  idCol: {alignItems: 'center', marginRight: 36},
  number: {color: brand.text, fontSize: 40, fontWeight: '900', marginBottom: 10},
  logoBox: {width: 200, height: 112, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden'},
  logo: {width: 184, height: 96},
  logoText: {color: brand.text, fontSize: type.small, fontWeight: '800', textAlign: 'center', paddingHorizontal: 8},
  main: {flex: 1},
  nameRow: {flexDirection: 'row', alignItems: 'center'},
  name: {color: brand.text, fontSize: type.title, fontWeight: '900', flexShrink: 1},
  badge: {color: brand.text, fontSize: 16, fontWeight: '900', borderWidth: 2, borderColor: brand.textMuted, borderRadius: 4, paddingHorizontal: 6, marginLeft: 14},
  flex: {flex: 1},
  live: {color: '#ff5c5c', fontSize: type.small, fontWeight: '800'},
  status: {color: brand.textSoft, fontSize: type.small, fontWeight: '700'},
  nowLine: {color: brand.text, fontSize: type.heading, fontWeight: '700', marginTop: 10},
  time: {color: brand.textSoft, fontWeight: '600'},
  track: {height: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 3, marginTop: 14, marginRight: 120},
  fill: {height: 5, backgroundColor: brand.accent, borderRadius: 3},
  desc: {color: brand.textSoft, fontSize: type.small, marginTop: 12, marginRight: 120},
  next: {color: brand.textMuted, fontSize: type.body, marginTop: 12},
  nextLabel: {color: brand.textMuted, fontWeight: '800'},
  tagLive: {color: '#ff4d5e', fontWeight: '900'},
  tagReplay: {color: brand.textMuted, fontWeight: '900'},
  warn: {color: '#ffb547', fontSize: type.small, marginTop: 10},
});
