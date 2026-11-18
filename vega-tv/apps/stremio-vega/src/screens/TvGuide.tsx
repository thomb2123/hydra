// TV guide: categories down the left (Live Sport first), channels on the right
// with logo, what's on now (time + progress) and what's next. One entry per real
// channel; the best working source is chosen behind the scenes.
import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Pill} from '../ui/Cards';
import {brand, edge, type} from '../ui/brand';
import {CATEGORIES} from '../tv/lineup';
import {MergedChannel} from '../tv/channels';
import {NowNext, cachedNowNext, cleanTitle, nowNext, progressOf, timeRange} from '../tv/epg';
import {SportEvent} from '../tv/events';
import {TvState} from '../tv/useTv';
import * as fx from '../tv/flixnest';
import {QrCode} from '../tv/QrCode';

export interface TvGuideProps {
  tv: TvState;
  nav: React.ReactNode;
  playChannel: (channel: MergedChannel, list: MergedChannel[]) => void;
  playEvent: (event: SportEvent) => void;
}

const SPORT_ID = 'live-sport';

export const TvGuide = ({tv, nav, playChannel, playEvent}: TvGuideProps) => {
  const channels = tv.guide?.channels || [];
  const categories = useMemo(() => {
    const present = CATEGORIES.filter((c) => channels.some((ch) => ch.category === c.id));
    return tv.events.length ? [{id: SPORT_ID, title: 'Live Sport'}, ...present] : present;
  }, [channels, tv.events.length]);
  const [categoryId, setCategoryId] = useState<string>('');
  const active = categoryId || categories[0]?.id || '';
  const list = useMemo(() => channels.filter((c) => c.category === active), [channels, active]);

  if (!tv.ready) {
    return <View style={styles.root}>{nav}</View>;
  }
  if (!tv.access) {
    return (
      <View style={styles.root}>
        {nav}
        <TvConnect tv={tv} />
      </View>
    );
  }
  if (tv.building && !channels.length) {
    const pct = Math.round((tv.building.done / Math.max(1, tv.building.total)) * 100);
    return (
      <View style={styles.root}>
        {nav}
        <View style={styles.center}>
          <Text style={styles.heading}>Setting up your TV guide</Text>
          <Text style={styles.muted}>{tv.building.label}</Text>
          <View style={styles.bar}>
            <View style={[styles.barFill, {width: `${pct}%`}]} />
          </View>
          <Text style={styles.muted}>This happens once; after that the guide opens instantly.</Text>
        </View>
      </View>
    );
  }
  if (!channels.length) {
    return (
      <View style={styles.root}>
        {nav}
        <View style={styles.center}>
          <Text style={styles.heading}>{tv.error || 'No channels yet'}</Text>
          <Pill label="Try again" primary hasTVPreferredFocus onPress={() => tv.rebuild()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {nav}
      <View style={styles.body}>
        <View style={styles.side}>
          {categories.map((c, i) => (
            <CategoryButton key={c.id} title={c.title} active={c.id === active} preferred={i === 0} onFocus={() => setCategoryId(c.id)} />
          ))}
        </View>
        <View style={styles.main}>
          {active === SPORT_ID ? (
            <FlatList
              key="sport"
              data={tv.events}
              keyExtractor={(e) => e.key}
              initialNumToRender={8}
              windowSize={3}
              renderItem={({item}) => <EventRow event={item} onPress={() => playEvent(item)} />}
            />
          ) : (
            <FlatList
              key={active}
              data={list}
              keyExtractor={(c) => c.id}
              initialNumToRender={7}
              maxToRenderPerBatch={4}
              windowSize={3}
              removeClippedSubviews
              renderItem={({item}) => <ChannelRow access={tv.access!} channel={item} onPress={() => playChannel(item, list)} />}
            />
          )}
        </View>
      </View>
    </View>
  );
};

const CategoryButton = ({title, active, preferred, onFocus}: {title: string; active: boolean; preferred: boolean; onFocus: () => void}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.cat, active && styles.catActive, focused && styles.catFocused]}>
      <Text numberOfLines={1} style={[styles.catText, active && styles.catTextActive, focused && styles.catTextFocused]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
};

export const ChannelRow = memo(({access, channel, onPress}: {access: fx.Access; channel: MergedChannel; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  const [info, setInfo] = useState<NowNext | null>(() => cachedNowNext(channel));
  useEffect(() => {
    let alive = true;
    if (!info) {
      nowNext(access, channel)
        .then((v) => alive && setInfo(v))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [access, channel, info]);
  const now = info?.now;
  const next = info?.next;
  const progress = progressOf(now);
  const best = channel.sources[0]?.quality || 2;
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityLabel={`${channel.name}${now?.title ? `, now ${cleanTitle(now.title)}` : ''}`}
      style={[styles.row, focused && styles.rowFocused]}>
      <View style={styles.logoBox}>
        {channel.logo ? <Image source={{uri: channel.logo}} style={styles.logo} resizeMode="contain" /> : <Text style={styles.logoText}>{channel.name}</Text>}
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.chName, focused && styles.textFocused]}>
            {channel.name}
          </Text>
          {best >= 4 ? <Text style={styles.badge}>UHD</Text> : best >= 3 ? <Text style={styles.badge}>HD</Text> : null}
        </View>
        <Text numberOfLines={1} style={[styles.nowTitle, focused && styles.textFocused]}>
          {now?.title ? `${timeRange(now)}  ${cleanTitle(now.title)}` : info ? 'No guide information' : ' '}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, {width: `${Math.round(progress * 100)}%`}]} />
        </View>
        {focused && now?.description ? (
          <Text numberOfLines={2} style={styles.desc}>
            {now.description}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={styles.nextTitle}>
          {next?.title ? `Next  ${timeRange(next).split('–')[0]}  ${cleanTitle(next.title)}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const EventRow = ({event, onPress}: {event: SportEvent; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  const when = event.live ? 'LIVE' : timeRange({start: event.start});
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, styles.eventRow, focused && styles.rowFocused]}>
      <Text style={[styles.when, event.live && styles.live]}>{when}</Text>
      <View style={styles.rowMain}>
        <Text numberOfLines={1} style={[styles.chName, focused && styles.textFocused]}>
          {event.title}
        </Text>
        <Text numberOfLines={1} style={styles.nextTitle}>
          {[event.sport, event.channelName].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

/** FlixNest sign-in by phone: shows a code + QR; the viewer approves on their phone. */
export const TvConnect = ({tv, onDone}: {tv: TvState; onDone?: () => void}) => {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('Getting a code…');
  const gen = useRef(0);
  const connectRef = useRef(tv.connect);
  connectRef.current = tv.connect;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const start = useCallback(() => {
    const current = ++gen.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let device = '';
    (async () => {
      try {
        const s = await fx.pairStart();
        if (current !== gen.current) {
          fx.pairCancel(s.device_code);
          return;
        }
        device = s.device_code;
        setCode(String(s.code || ''));
        setStatus('Waiting for you to approve on your phone…');
        const expires = Date.now() + Number(s.expires_in || 600) * 1000;
        const interval = Math.max(2, Number(s.interval) || 3) * 1000;
        const poll = async () => {
          if (current !== gen.current) {
            return;
          }
          if (Date.now() > expires) {
            setStatus('Code expired. Press "New code".');
            return;
          }
          try {
            const r = await fx.pairPoll(device);
            if (r.status === 'approved' && r.access && r.access.type === 'account') {
              setStatus('Approved. Setting up your channels…');
              await connectRef.current({type: 'account', scope: r.access.scope});
              onDoneRef.current?.();
              return;
            }
          } catch {
            // Keep polling through network hiccups.
          }
          timer = setTimeout(poll, interval);
        };
        timer = setTimeout(poll, interval);
      } catch (e: any) {
        setStatus(`Couldn't get a code: ${e?.message || e}`);
      }
    })();
    return () => {
      gen.current++;
      if (timer) {
        clearTimeout(timer);
      }
      if (device) {
        fx.pairCancel(device);
      }
    };
  }, []);
  useEffect(() => start(), [start]);
  return (
    <View style={styles.connect}>
      {code ? <QrCode text={fx.pairUrl(code)} size={320} /> : <View style={styles.qrHolder} />}
      <View style={styles.connectText}>
        <Text style={styles.heading}>Watch live TV</Text>
        <Text style={styles.bodyText}>Live channels come from your FlixNest account. On your phone, open</Text>
        <Text style={styles.link}>player.flixnest.app/webplayer/pair</Text>
        <Text style={styles.bodyText}>or scan the code, then enter</Text>
        <Text style={styles.code}>{code ? fx.formatCode(code) : '…'}</Text>
        <Text style={styles.muted}>{status}</Text>
        <View style={styles.actions}>
          <Pill label="New code" primary hasTVPreferredFocus onPress={() => start()} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: brand.background},
  body: {flex: 1, flexDirection: 'row', paddingTop: 10},
  side: {width: 380, paddingLeft: edge - 10, paddingRight: 16},
  main: {flex: 1, paddingRight: edge - 20},
  cat: {paddingVertical: 14, paddingHorizontal: 18, borderRadius: 8, marginBottom: 6},
  catActive: {backgroundColor: brand.surface},
  catFocused: {backgroundColor: brand.text},
  catText: {color: brand.textMuted, fontSize: type.body, fontWeight: '700'},
  catTextActive: {color: brand.text},
  catTextFocused: {color: '#000'},
  row: {flexDirection: 'row', alignItems: 'center', backgroundColor: brand.canvas, borderRadius: 10, borderWidth: 3, borderColor: 'transparent', padding: 12, marginBottom: 10},
  rowFocused: {borderColor: brand.text, backgroundColor: brand.surfaceRaised},
  eventRow: {paddingVertical: 18},
  logoBox: {width: 150, height: 84, borderRadius: 8, backgroundColor: brand.surface, justifyContent: 'center', alignItems: 'center', marginRight: 22, overflow: 'hidden'},
  logo: {width: 136, height: 72},
  logoText: {color: brand.text, fontSize: type.small, fontWeight: '800', textAlign: 'center', paddingHorizontal: 6},
  rowMain: {flex: 1},
  rowTop: {flexDirection: 'row', alignItems: 'center'},
  chName: {color: brand.text, fontSize: type.body + 2, fontWeight: '800', flexShrink: 1},
  textFocused: {color: brand.text},
  badge: {color: brand.text, fontSize: 15, fontWeight: '900', borderWidth: 2, borderColor: brand.textMuted, borderRadius: 4, paddingHorizontal: 6, marginLeft: 12},
  nowTitle: {color: brand.textSoft, fontSize: type.small + 1, marginTop: 4},
  desc: {color: brand.textMuted, fontSize: type.tiny, marginTop: 4},
  progressTrack: {height: 4, backgroundColor: brand.surfaceRaised, borderRadius: 2, marginTop: 8, marginRight: 40},
  progressFill: {height: 4, backgroundColor: brand.accent, borderRadius: 2},
  nextTitle: {color: brand.textMuted, fontSize: type.tiny + 1, marginTop: 6},
  when: {width: 120, color: brand.text, fontSize: type.body, fontWeight: '900', textAlign: 'center', marginRight: 14},
  live: {color: '#ff4d4d'},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 120},
  heading: {color: brand.text, fontSize: type.title, fontWeight: '900', marginBottom: 12},
  muted: {color: brand.textMuted, fontSize: type.body, marginVertical: 8},
  bar: {width: 800, height: 8, backgroundColor: brand.surfaceRaised, borderRadius: 4, marginVertical: 18, overflow: 'hidden'},
  barFill: {height: 8, backgroundColor: brand.accent},
  connect: {flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: edge + 40},
  qrHolder: {width: 320, height: 320, backgroundColor: brand.surface, borderRadius: 12},
  connectText: {flex: 1, marginLeft: 70},
  bodyText: {color: brand.textSoft, fontSize: type.body, marginVertical: 4},
  link: {color: brand.accent, fontSize: type.body + 2, fontWeight: '800'},
  code: {color: brand.text, fontSize: 76, fontWeight: '900', letterSpacing: 6, marginVertical: 10},
  actions: {flexDirection: 'row', marginTop: 16},
});
