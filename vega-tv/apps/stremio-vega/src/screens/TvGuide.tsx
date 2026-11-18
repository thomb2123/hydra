// TV guide: categories down the left (Live Now first), channels on the right
// with number, logo, what's on now (time + progress) and what's next. One entry
// per real channel; the best working source is chosen behind the scenes, and a
// channel you rest on is checked in the background so OK starts it at once.
// The guide reopens on the last channel watched, like a TV box.
import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {Pill} from '../ui/Cards';
import {brand, edge, type} from '../ui/brand';
import {CATEGORIES} from '../tv/lineup';
import {MergedChannel} from '../tv/channels';
import {NowNext, cachedNowNext, cleanTitle, displayTitle, nowNext, nowTag, progressOf, timeRange} from '../tv/epg';
import {LIVE_NOW_ID, SportEvent} from '../tv/events';
import {ProgrammeTag} from '../tv/scores';
import {describe, guideLabel} from '../tv/officialGuide';
import {useRemoteKeys} from '../../../../shared/src/tv/remote';
import {prefetchChannel} from '../tv/tune';
import {TvState} from '../tv/useTv';
import * as fx from '../tv/flixnest';
import {QrCode} from '../tv/QrCode';

export interface TvGuideProps {
  tv: TvState;
  nav: React.ReactNode;
  playChannel: (channel: MergedChannel, list: MergedChannel[]) => void;
  playEvent: (event: SportEvent) => void;
}

const SPORT_ID = LIVE_NOW_ID;
const FAVOURITES_ID = 'my-favourites';
const RECENT_ID = 'my-recent';

export const TvGuide = ({tv, nav, playChannel, playEvent}: TvGuideProps) => {
  const channels = tv.guide?.channels || [];
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const favouriteList = useMemo(() => tv.favourites.map((id) => byId.get(id)).filter((c): c is MergedChannel => !!c), [tv.favourites, byId]);
  const recentList = useMemo(() => tv.recent.map((id) => byId.get(id)).filter((c): c is MergedChannel => !!c), [tv.recent, byId]);
  const categories = useMemo(() => {
    const present = CATEGORIES.filter((c) => channels.some((ch) => ch.category === c.id));
    const mine = [
      ...(favouriteList.length ? [{id: FAVOURITES_ID, title: 'Favourites'}] : []),
      ...(recentList.length ? [{id: RECENT_ID, title: 'Recently Watched'}] : []),
    ];
    return [...(tv.events.length ? [{id: SPORT_ID, title: 'Live Now'}] : []), ...mine, ...present];
  }, [channels, tv.events.length, favouriteList.length, recentList.length]);
  // Reopen where the viewer left off (last channel watched), else the first category.
  const [categoryId, setCategoryId] = useState<string>(() => tv.last?.category || '');
  const active = categories.some((c) => c.id === categoryId) ? categoryId : categories[0]?.id || '';
  const list = useMemo(
    () => (active === FAVOURITES_ID ? favouriteList : active === RECENT_ID ? recentList : channels.filter((c) => c.category === active)),
    // Recently Watched keeps its order while open (watching reorders it for next time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, active, favouriteList, active === RECENT_ID ? null : recentList],
  );
  const favouriteSet = useMemo(() => new Set(tv.favourites), [tv.favourites]);
  // Only the first view of the guide puts focus on the last channel watched. After the
  // viewer starts moving, nothing grabs focus (a list appearing must not pull focus in).
  const settled = useRef(false);
  const markSettled = useCallback(() => {
    settled.current = true;
  }, []);
  const resumeIndex = useMemo(
    () => (!settled.current && tv.last && tv.last.category === active ? list.findIndex((c) => c.id === tv.last!.channelId) : -1),
    [list, active, tv.last],
  );
  // Back from a Live Now event: focus that event (if it is still on).
  const resumeEvent = useMemo(
    () => (!settled.current && tv.last && tv.last.category === SPORT_ID && active === SPORT_ID ? tv.events.findIndex((e) => e.key === tv.last!.channelId) : -1),
    [tv.events, active, tv.last],
  );
  // Moving down the categories switches the list only once focus rests (no rebuild per step).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chooseCategory = useCallback(
    (id: string) => {
      markSettled();
      if (pending.current) {
        clearTimeout(pending.current);
      }
      pending.current = setTimeout(() => {
        pending.current = null;
        setCategoryId(id);
      }, 160);
    },
    [markSettled],
  );
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current);
      }
    },
    [],
  );
  // Category buttons by id, so the column can send focus straight to the current one.
  const catRefs = useRef(new Map<string, any>());
  const [, setCatsMounted] = useState(false);
  const registerCat = useCallback((id: string, ref: any) => {
    if (ref) {
      const first = !catRefs.current.size;
      catRefs.current.set(id, ref);
      if (first) {
        setCatsMounted(true); // re-render once so the column knows its destination
      }
    } else {
      catRefs.current.delete(id);
    }
  }, []);
  const access = tv.access;
  const tagFor = tv.programmeTag;
  // The focused channel's programme details go to a fixed panel above the list
  // (through a ref, so rows and the list never re-render or change height).
  const detailsRef = useRef<((d: Details | null) => void) | null>(null);
  // The channel that has focus right now (null once focus leaves the list), for ☰.
  const focusedChannel = useRef<MergedChannel | null>(null);
  const showDetails = useCallback((d: Details | null) => {
    focusedChannel.current = d?.channel || null;
    detailsRef.current?.(d);
  }, []);
  const leaveChannel = useCallback((id: string) => {
    if (focusedChannel.current?.id === id) {
      focusedChannel.current = null;
    }
  }, []);
  // ☰ on a channel adds it to (or removes it from) Favourites.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleFavourite = tv.toggleFavourite;
  useRemoteKeys((key) => {
    const c = focusedChannel.current;
    if ((key === 'menu' || key === 'context_menu') && c) {
      const added = toggleFavourite(c.id);
      setToast(added ? `★  ${c.name} added to Favourites` : `${c.name} removed from Favourites`);
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
      toastTimer.current = setTimeout(() => setToast(null), 2200);
    }
  });
  useEffect(() => () => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
  }, []);
  const renderChannel = useCallback(
    ({item, index}: {item: MergedChannel; index: number}) => (
      <ChannelRow
        access={access!}
        channel={item}
        preferred={index === resumeIndex}
        liveTitle={liveOnRef.current.get(item.id)}
        favourite={favouriteSet.has(item.id)}
        onFocused={markSettled}
        onDetails={showDetails}
        onLeave={leaveChannel}
        tagFor={tagFor}
        onPress={() => playChannel(item, list)}
      />
    ),
    [access, resumeIndex, markSettled, playChannel, list, tagFor, showDetails, leaveChannel, favouriteSet],
  );
  const renderEvent = useCallback(
    ({item, index}: {item: SportEvent; index: number}) => <EventRow event={item} preferred={index === resumeEvent} onFocused={markSettled} onPress={() => playEvent(item)} />,
    [markSettled, playEvent, resumeEvent],
  );
  // Sport channels without guide data show the match they are carrying.
  const liveOn = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of tv.events) {
      if (e.live && e.channelId && !map.has(e.channelId)) {
        map.set(e.channelId, e.title);
      }
    }
    return map;
  }, [tv.events]);
  const liveOnRef = useRef(liveOn);
  liveOnRef.current = liveOn;
  const activeTitle = categories.find((c) => c.id === active)?.title || '';

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
        {/* Left from the channels returns to the category you are in, not the nearest one. */}
        <TVFocusGuideView destinations={[catRefs.current.get(active) || null]} style={styles.side}>
          {categories.map((c, i) => (
            <CategoryButton
              key={c.id}
              id={c.id}
              title={c.title}
              active={c.id === active}
              preferred={!settled.current && resumeIndex < 0 && resumeEvent < 0 && i === 0}
              onChoose={chooseCategory}
              register={registerCat}
            />
          ))}
        </TVFocusGuideView>
        {/* Right from the categories lands on the channel you were last on in this list. */}
        <TVFocusGuideView autoFocus style={styles.main}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{activeTitle}</Text>
            <Clock />
          </View>
          {active === SPORT_ID ? (
            <FlatList
              key="sport"
              data={tv.events}
              keyExtractor={(e) => e.key}
              initialNumToRender={8}
              windowSize={7}
              renderItem={renderEvent}
            />
          ) : (
            <DetailsPanel register={detailsRef} />
          )}
          {active === SPORT_ID ? null : (
            <FlatList
              key={active}
              data={list}
              keyExtractor={(c) => c.id}
              initialNumToRender={Math.max(8, resumeIndex + 3)}
              maxToRenderPerBatch={8}
              windowSize={9}
              renderItem={renderChannel}
            />
          )}
        </TVFocusGuideView>
      </View>
      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
};

const CategoryButton = memo(
  ({id, title, active, preferred, onChoose, register}: {id: string; title: string; active: boolean; preferred: boolean; onChoose: (id: string) => void; register: (id: string, ref: any) => void}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      ref={(r) => register(id, r)}
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onFocus={() => {
        setFocused(true);
        onChoose(id);
      }}
      onBlur={() => setFocused(false)}
      style={[styles.cat, active && styles.catActive, focused && styles.catFocused]}>
      <Text numberOfLines={1} style={[styles.catText, active && styles.catTextActive, focused && styles.catTextFocused]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
  },
);

const Clock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return (
    <Text style={styles.clock}>
      <Text style={styles.clockDate}>{`${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}   `}</Text>
      {`${hh}:${mm}`}
    </Text>
  );
};

interface Details {
  channel: MergedChannel;
  info: NowNext | null;
  tag: ProgrammeTag;
}

/** What the focused channel is showing: title, synopsis and whose guide it is. Fixed height. */
const DetailsPanel = ({register}: {register: React.MutableRefObject<((d: Details | null) => void) | null>}) => {
  const [d, setD] = useState<Details | null>(null);
  useEffect(() => {
    register.current = setD;
    return () => {
      register.current = null;
    };
  }, [register]);
  // A description that did not arrive with the listing (busy network while the list
  // loaded) is fetched for the channel being looked at.
  const [extra, setExtra] = useState<{key: string; text: string} | null>(null);
  const shown = d?.info?.now;
  const key = shown ? `${d!.channel.id}|${shown.start}` : '';
  useEffect(() => {
    let alive = true;
    if (shown && shown.programId && !shown.description) {
      describe(shown).then((p) => alive && p?.description && setExtra({key, text: p.description}));
    }
    return () => {
      alive = false;
    };
  }, [key, shown]);
  const now = shown && !shown.description && extra?.key === key ? {...shown, description: extra.text} : shown;
  const source = !d ? '' : `${!d.info ? '' : d.info.official ? `${guideLabel(d.info.guide)}   ·   ` : 'Not in a TV guide   ·   '}☰ Favourite`;
  const warn = d?.info?.streamSays
    ? `The stream is labelled "${d.info.streamSays}". If the picture differs, open Sources (☰) while watching.`
    : d?.info && !d.info.official && d.info.noGuide
      ? `${d.info.noGuide}. ${now?.title ? "Shown: the stream's own label." : ''}`
      : ' ';
  return (
    <View style={styles.details}>
      <View style={styles.rowTop}>
        <Text numberOfLines={1} style={styles.detailsTitle}>
          {d?.tag ? <Text style={d.tag === 'LIVE' ? styles.tagLive : styles.tagReplay}>{d.tag === 'LIVE' ? 'LIVE  ' : 'REPLAY  '}</Text> : null}
          {now?.title ? displayTitle(now) : d ? d.channel.name : ' '}
        </Text>
        <Text style={styles.detailsSource}>{source}</Text>
      </View>
      <Text numberOfLines={2} style={styles.detailsDesc}>
        {now?.description || (d && now?.title ? `${timeRange(now)} on ${d.channel.name}` : d && !d.info ? 'Loading listings…' : d ? 'No listings for this channel right now.' : ' ')}
      </Text>
      <Text numberOfLines={1} style={styles.detailsWarn}>
        {warn}
      </Text>
    </View>
  );
};

type Avail = 'unknown' | 'checking' | 'on' | 'off';

const SPORT_CATEGORIES = new Set(['uk-sport', 'us-sport']);

export const ChannelRow = memo(({access, channel, preferred, liveTitle, favourite, onFocused, onDetails, onLeave, tagFor, onPress}: {access: fx.Access; channel: MergedChannel; preferred?: boolean; liveTitle?: string; favourite?: boolean; onFocused?: () => void; onDetails?: (d: Details | null) => void; onLeave?: (id: string) => void; tagFor?: (title: string) => ProgrammeTag; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  const [avail, setAvail] = useState<Avail>('unknown');
  const [info, setInfo] = useState<NowNext | null>(() => cachedNowNext(channel));
  // Resting on a channel for a moment checks it is really on air and readies its
  // stream, so pressing OK starts the picture straight away.
  useEffect(() => {
    if (!focused) {
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setAvail((a) => (a === 'unknown' ? 'checking' : a));
      prefetchChannel(access, channel).then((found) => alive && setAvail(found ? 'on' : 'off'));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [access, channel, focused]);
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
  // LIVE / REPLAY next to what is on, so a re-run is obvious before choosing the channel.
  const tag = nowTag(info, SPORT_CATEGORIES.has(channel.category), tagFor);
  const nowText = now?.title ? `${timeRange(now)}  ${displayTitle(now)}` : liveTitle ? `Live  ${liveTitle}` : info ? 'No listings available' : ' ';
  useEffect(() => {
    if (focused) {
      onDetails?.({channel, info, tag});
    }
  }, [focused, info, tag, channel, onDetails]);
  return (
    <TouchableOpacity
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocused?.();
      }}
      onBlur={() => {
        setFocused(false);
        onLeave?.(channel.id);
      }}
      accessibilityLabel={`${channel.name}${now?.title ? `, now ${cleanTitle(now.title)}` : ''}`}
      style={[styles.row, focused && styles.rowFocused]}>
      <View style={styles.logoBox}>
        {channel.logo ? <Image source={{uri: channel.logo}} style={styles.logo} resizeMode="contain" /> : <Text style={styles.logoText}>{channel.name}</Text>}
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={styles.chNumber}>{channel.number}</Text>
          <Text numberOfLines={1} style={[styles.chName, focused && styles.textFocused]}>
            {channel.name}
          </Text>
          {channel.badge ? <Text style={styles.badge}>{channel.badge}</Text> : null}
          {favourite ? <Text style={styles.star}>★</Text> : null}
          <View style={styles.flex} />
          {avail === 'off' ? <Text style={styles.offAir}>Off air right now</Text> : null}
        </View>
        <Text numberOfLines={1} style={[styles.nowTitle, focused && styles.textFocused, avail === 'off' && styles.dim]}>
          {tag ? <Text style={tag === 'LIVE' ? styles.tagLive : styles.tagReplay}>{tag === 'LIVE' ? 'LIVE  ' : 'REPLAY  '}</Text> : null}
          {nowText}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, {width: `${Math.round(progress * 100)}%`}]} />
        </View>
        {/* (No extra description line on focus: rows keep one height, so the list never shifts.) */}
        <Text numberOfLines={1} style={styles.nextTitle}>
          {next?.title ? `Next  ${timeRange(next).split('–')[0]}  ${cleanTitle(next.title)}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const EventRow = ({event, preferred, onFocused, onPress}: {event: SportEvent; preferred?: boolean; onFocused?: () => void; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  const when = event.live ? 'LIVE' : timeRange({start: event.start});
  return (
    <TouchableOpacity
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocused?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.row, styles.eventRow, focused && styles.rowFocused]}>
      <Text style={[styles.when, event.live && styles.live]}>{when}</Text>
      <View style={styles.rowMain}>
        <Text numberOfLines={1} style={[styles.chName, focused && styles.textFocused]}>
          {event.title}
        </Text>
        <Text numberOfLines={1} style={styles.eventMeta}>
          {[event.competition || event.sport, event.channelName, event.live && event.start ? `started ${timeRange({start: event.start})}` : ''].filter(Boolean).join('  ·  ')}
        </Text>
        {event.live ? (
          <Text numberOfLines={1} style={event.confirmed ? styles.confirmed : styles.unconfirmed}>
            {event.confirmed ? '✓ The TV guide lists it on this channel now' : 'Not confirmed by a TV guide: this feed may show something else'}
          </Text>
        ) : null}
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
  header: {flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 6, marginBottom: 12},
  headerTitle: {flex: 1, color: brand.text, fontSize: type.heading, fontWeight: '900'},
  clock: {color: brand.text, fontSize: type.heading, fontWeight: '800'},
  clockDate: {color: brand.textMuted, fontSize: type.body, fontWeight: '700'},
  flex: {flex: 1},
  chNumber: {color: brand.textMuted, fontSize: type.body, fontWeight: '800', width: 62},
  offAir: {color: brand.textMuted, fontSize: type.tiny, fontWeight: '700', marginRight: 20},
  dim: {color: brand.textMuted},
  eventMeta: {color: brand.textSoft, fontSize: type.small, marginTop: 6},
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
  tagLive: {color: '#ff4d5e', fontWeight: '900'},
  tagReplay: {color: brand.textMuted, fontWeight: '900'},
  nowTitle: {color: brand.textSoft, fontSize: type.small + 1, marginTop: 4},
  desc: {color: brand.textMuted, fontSize: type.tiny, marginTop: 4},
  details: {height: 132, backgroundColor: brand.surface, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 14, marginBottom: 12, marginHorizontal: 3},
  detailsTitle: {flex: 1, color: brand.text, fontSize: type.body + 2, fontWeight: '800'},
  detailsSource: {color: brand.textMuted, fontSize: type.tiny, fontWeight: '700', marginLeft: 16},
  detailsDesc: {color: brand.textSoft, fontSize: type.small, marginTop: 6, lineHeight: type.small + 8},
  detailsWarn: {color: '#ffb547', fontSize: type.tiny, marginTop: 4},
  confirmed: {color: brand.match, fontSize: type.tiny, marginTop: 4},
  star: {color: '#ffc940', fontSize: type.body, marginLeft: 12},
  toast: {position: 'absolute', bottom: 60, alignSelf: 'center', backgroundColor: 'rgba(20,20,26,0.96)', borderRadius: 12, paddingHorizontal: 34, paddingVertical: 18, borderWidth: 2, borderColor: brand.surfaceRaised},
  toastText: {color: brand.text, fontSize: type.body, fontWeight: '800'},
  unconfirmed: {color: '#ffb547', fontSize: type.tiny, marginTop: 4},
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
