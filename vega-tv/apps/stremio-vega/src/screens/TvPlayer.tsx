// Plays a merged channel like a TV box. On tune it finds the best-ranked source
// that is really live (placeholders such as "Maintenance" clips, black screens
// and dead links are skipped; channels hovered in the guide are already checked),
// shows the now/next banner while the picture comes up, switches source by
// itself if the picture is lost, zaps with ▲/▼, OK shows the banner and ☰ opens
// "Sources" to pick by hand.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {PlaySource, VideoScreen} from '../../../../shared/src/player/VideoScreen';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {Pill} from '../ui/Cards';
import {brand, type} from '../ui/brand';
import * as fx from '../tv/flixnest';
import {MergedChannel, Source} from '../tv/channels';
import {NowNext, displayTitle, msUntilChange, nowNext} from '../tv/epg';
import {describe as addDescription, guideLabel} from '../tv/officialGuide';
import {recordResult} from '../tv/guide';
import {probeStream} from '../tv/probe';
import {Status, cachedStatus, checkSource, firstLive, heightOf, markFailed, prefetchChannel} from '../tv/tune';
import {ChannelBanner} from '../tv/ChannelBanner';
import {MiniGuide} from '../tv/MiniGuide';

export interface TvPlayerProps {
  access: fx.Access;
  list: MergedChannel[];
  index: number;
  /** For sport events without a curated channel: play these feeds directly. */
  feeds?: Source[];
  title?: string;
  /** Name of the channel/feed for a sport event (shown in the banner). */
  feedName?: string;
  onExit: () => void;
  onRanked?: () => void;
  /** Reports the channel now on screen (the guide reopens on it). */
  onChannel?: (channel: MergedChannel) => void;
  log?: (line: string) => void;
}

const START_TIMEOUT_MS = 12000;
const BANNER_MS = 5000;

const qualityLabel = (q: number) => (q >= 4 ? 'UHD' : q >= 3 ? 'Full HD' : q >= 2 ? 'HD' : 'SD');

export const TvPlayer = ({access, list, index: startIndex, feeds, title, feedName, onExit, onRanked, onChannel, log = () => undefined}: TvPlayerProps) => {
  const [index, setIndex] = useState(startIndex);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [playing, setPlaying] = useState<Source | null>(null);
  const [playingStatus, setPlayingStatus] = useState<Status | null>(null);
  const [measured, setMeasured] = useState(0);
  const [source, setSource] = useState<PlaySource | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  /** The channel list over the picture (OK while the banner is showing). */
  const [channelList, setChannelList] = useState(false);
  const [info, setInfo] = useState<NowNext | null>(null);
  const [banner, setBanner] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const gen = useRef(0);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(statuses);
  statusRef.current = statuses;

  const channel: MergedChannel | undefined = list[index];
  const sources: Source[] = feeds && feeds.length ? feeds : channel?.sources || [];
  const name = feeds ? feedName || title || 'Live sport' : channel?.name || 'Live TV';

  const setStatus = (s: Source, st: Status) => setStatuses((prev) => ({...prev, [s.id]: st}));

  const showBanner = useCallback((ms = BANNER_MS) => {
    setBanner(true);
    if (bannerTimer.current) {
      clearTimeout(bannerTimer.current);
    }
    bannerTimer.current = setTimeout(() => setBanner(false), ms);
  }, []);
  const holdBanner = useCallback(() => {
    setBanner(true);
    if (bannerTimer.current) {
      clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
  }, []);
  useEffect(() => () => {
    if (bannerTimer.current) {
      clearTimeout(bannerTimer.current);
    }
  }, []);

  const start = useCallback(
    (s: Source, st: Status) => {
      setPlaying(s);
      setPlayingStatus(st);
      setMeasured(0);
      setFailure(null);
      setSource({
        url: st.url!,
        mime: st.mime || 'application/vnd.apple.mpegurl',
        title: name,
        live: true,
        startTimeoutMs: START_TIMEOUT_MS,
      });
    },
    [name],
  );

  /** Automatic choice: the best-ranked source that is actually live. */
  const tune = useCallback(
    async (skip: Set<string>) => {
      const g = ++gen.current;
      setSource(null);
      setPanel(false);
      holdBanner();
      const queue = sources.filter((s) => !skip.has(s.id));
      try {
        const found = await firstLive(access, queue, {
          alive: () => g === gen.current,
          onStatus: (s, st) => g === gen.current && setStatus(s, st),
          log,
        });
        if (g !== gen.current) {
          return;
        }
        if (found) {
          log(`tv ${name}: playing source ${sources.indexOf(found.source) + 1}/${sources.length} (${found.source.provider})`);
          start(found.source, found.status);
        } else {
          setFailure(`${name} isn't available at the moment.`);
        }
      } catch (e: any) {
        if (g !== gen.current) {
          return;
        }
        setFailure(fx.needsSignIn(e) ? 'Your FlixNest sign-in has ended. Reconnect it in Settings › Live TV.' : `${name} isn't available at the moment.`);
        log(`tv ${name}: tune failed: ${e?.message || e}`);
      }
    },
    [access, holdBanner, log, name, sources, start],
  );

  // New channel: guide info, remember it, tune.
  useEffect(() => {
    setStatuses({});
    setPlaying(null);
    setPlayingStatus(null);
    setInfo(null);
    setNote(null);
    if (channel && !feeds) {
      onChannel?.(channel);
      loadInfo(channel);
    }
    tune(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Listing for the channel on screen (a late answer for a channel already left is dropped).
  const infoFor = useRef<string | null>(null);
  const loadInfo = useCallback(
    (ch: MergedChannel) => {
      infoFor.current = ch.id;
      nowNext(access, ch, true)
        .then(async (v) => {
          if (infoFor.current !== ch.id) {
            return;
          }
          setInfo(v);
          if (v.now?.programId && !v.now.description) {
            const now = await addDescription(v.now);
            if (now?.description && infoFor.current === ch.id) {
              setInfo((cur) => (cur === v ? {...v, now} : cur));
            }
          }
        })
        .catch(() => undefined);
    },
    [access],
  );
  // Watching for a while: when the programme ends, the banner moves on to the next one.
  useEffect(() => {
    if (!info || !channel || feeds) {
      return undefined;
    }
    const timer = setTimeout(() => loadInfo(channel), msUntilChange(info));
    return () => clearTimeout(timer);
  }, [info, channel, feeds, loadInfo]);

  const onFailed = useCallback(
    (reason: string) => {
      if (!playing) {
        return;
      }
      log(`tv ${name}: ${playing.provider} lost (${reason}); switching source`);
      markFailed(playing);
      recordResult(playing, false).catch(() => undefined);
      setStatus(playing, {...(statusRef.current[playing.id] || {}), state: 'failed'});
      setNote('Switching to another source…');
      const bad = new Set(Object.entries(statusRef.current).filter(([, st]) => st.state !== 'live' && st.state !== 'checking').map(([id]) => id));
      bad.add(playing.id);
      tune(bad);
    },
    [log, name, playing, tune],
  );
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  // While watching: re-check the playing source; if the provider swaps it for a
  // placeholder (maintenance clip / black screen) or it disappears, move on.
  useEffect(() => {
    if (!source || !playing) {
      return undefined;
    }
    const url = source.url;
    const timer = setInterval(async () => {
      const probe = await probeStream(url);
      if (probe.state !== 'live' && source.url === url) {
        log(`tv ${name}: source went ${probe.state} while watching (${probe.why || ''})`);
        onFailedRef.current('went off air');
      }
    }, 45000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, playing]);

  const onStarted = useCallback(
    ({height}: {width: number; height: number}) => {
      const h = height || heightOf(playingStatus?.resolution);
      setMeasured(h);
      setNote(null);
      showBanner();
      if (playing) {
        recordResult(playing, true, h)
          .then(() => onRanked?.())
          .catch(() => undefined);
      }
      // Check the channels either side, so ▲/▼ is near-instant.
      if (!feeds && list.length > 1) {
        setTimeout(() => {
          for (const step of [1, -1]) {
            const neighbour = list[(index + step + list.length) % list.length];
            if (neighbour) {
              prefetchChannel(access, neighbour);
            }
          }
        }, 2500);
      }
    },
    [access, feeds, index, list, onRanked, playing, playingStatus, showBanner],
  );

  // ◀ jumps back to the channel watched before this one (like a TV remote's "last" key).
  const previousIndex = useRef<number | null>(null);
  const zap = useCallback(
    (step: number) => {
      if (feeds || list.length < 2) {
        return;
      }
      setIndex((i) => {
        previousIndex.current = i;
        return (i + step + list.length) % list.length;
      });
    },
    [feeds, list.length],
  );
  const canList = !feeds && list.length > 1;
  const chooseFromList = useCallback(
    (i: number) => {
      setChannelList(false);
      if (i !== index) {
        previousIndex.current = index;
        setIndex(i);
      } else {
        showBanner();
      }
    },
    [index, showBanner],
  );
  const backToPrevious = useCallback(() => {
    const prev = previousIndex.current;
    if (feeds || prev == null || prev === index || prev >= list.length) {
      return;
    }
    previousIndex.current = index;
    setIndex(prev);
  }, [feeds, index, list.length]);

  const choose = useCallback(
    async (s: Source) => {
      const g = ++gen.current;
      // Switching away by hand means that source looked wrong (another channel, a
      // "maintenance" clip, poor picture): it drops down the list for a while.
      if (playing && playing.id !== s.id) {
        log(`tv ${name}: viewer switched from ${playing.provider} to ${s.provider}; demoting the first`);
        markFailed(playing);
        recordResult(playing, false)
          .then(() => onRanked?.())
          .catch(() => undefined);
      }
      setPanel(false);
      setSource(null);
      holdBanner();
      const known = cachedStatus(s);
      const st = known && known.state === 'live' ? known : await checkSource(access, s, log).catch(() => ({state: 'refused'}) as Status);
      if (g !== gen.current) {
        return;
      }
      setStatus(s, st);
      if (st.state === 'live') {
        start(s, st);
      } else {
        setFailure(`That source is ${st.state === 'placeholder' ? 'off air' : 'not available'} right now.`);
      }
    },
    [access, holdBanner, log, start, playing, name, onRanked],
  );

  useBackHandler(() => {
    if (channelList) {
      setChannelList(false);
      return true;
    }
    if (panel) {
      setPanel(false);
      return true;
    }
    if (!source) {
      gen.current++;
      onExit();
      return true;
    }
    return false;
  });

  // Badge: what the picture really is once playing; otherwise the channel's verified badge.
  const height = measured || heightOf(playingStatus?.resolution);
  const badge = height >= 2000 ? 'UHD' : height >= 700 ? 'HD' : height > 0 ? 'SD' : channel?.badge || '';
  const bannerView = (
    <ChannelBanner
      number={feeds ? undefined : channel?.number}
      name={name}
      logo={feeds ? undefined : channel?.logo}
      badge={badge}
      info={feeds ? null : info}
      sport={!!channel && (channel.category === 'uk-sport' || channel.category === 'us-sport')}
      fallbackTitle={feeds ? title : undefined}
      status={!source ? note || 'Tuning…' : undefined}
      hint={source ? [canList ? 'OK  All channels' : '', sources.length > 1 ? '☰  Sources' : '', canList ? '▲▼  Change channel' : '', previousIndex.current != null && canList ? '◀  Last channel' : ''].filter(Boolean).join('      ') : undefined}
    />
  );

  const sourcesPanel = panel ? (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Sources · {name}</Text>
      <Text style={styles.panelHint}>
        {info?.official && info.now?.title
          ? `Should be showing (${guideLabel(info.guide)}):${displayTitle(info.now)}. Pick another source if the picture differs.`
          : 'Chosen automatically. Pick another if this one looks wrong.'}
      </Text>
      <FlatList
        data={sources}
        keyExtractor={(s) => s.id}
        renderItem={({item, index: i}) => (
          <SourceRow
            label={`Source ${i + 1}`}
            quality={statuses[item.id]?.resolution ? describeResolution(statuses[item.id]!.resolution!) : qualityLabel(item.quality)}
            status={item.id === playing?.id && source ? 'Playing' : describe(statuses[item.id] || cachedStatus(item) || undefined)}
            guide={info?.sourceNow?.[item.id]}
            guideOk={info?.official ? !info.outliers.includes(item.id) : undefined}
            preferred={item.id === playing?.id || (!playing && i === 0)}
            onPress={() => choose(item)}
          />
        )}
      />
    </View>
  ) : null;

  if (failure) {
    return (
      <View style={styles.center}>
        {channel && !feeds ? <Text style={styles.failNumber}>{channel.number}</Text> : null}
        <Text style={styles.title}>{failure}</Text>
        <Text style={styles.muted}>
          {sources.length > 1 ? `All ${sources.length} sources were checked just now. Try again in a minute, or pick a source yourself.` : 'Try again in a minute.'}
        </Text>
        <View style={styles.actions}>
          <Pill label="Try again" primary hasTVPreferredFocus onPress={() => tune(new Set())} />
          {sources.length > 1 ? (
            <Pill
              label="Sources"
              onPress={() => {
                setFailure(null);
                setPanel(true);
              }}
            />
          ) : null}
          {!feeds && list.length > 1 ? <Pill label="Next channel" onPress={() => zap(1)} /> : null}
          <Pill label="Back to guide" onPress={onExit} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      {source ? (
        <VideoScreen
          key={`${index}:${playing?.id}:${source.url}`}
          source={source}
          onExit={onExit}
          onLog={log}
          onFailed={onFailed}
          onEnded={() => onFailed('stream ended')}
          onStarted={onStarted}
          onZap={feeds ? undefined : zap}
          onPrevious={feeds ? undefined : backToPrevious}
          onMenu={sources.length > 1 ? () => setPanel(true) : undefined}
          onInfo={() => {
            // OK shows the banner; OK again (banner up) opens the channel list.
            if (banner && canList) {
              setChannelList(true);
              setBanner(false);
            } else {
              showBanner(8000);
            }
          }}
          chromeless
          inputLocked={panel || channelList}
        />
      ) : null}
      {(banner || !source) && !channelList ? bannerView : null}
      {sourcesPanel}
      {channelList && canList ? <MiniGuide access={access} list={list} current={index} onChoose={chooseFromList} /> : null}
    </View>
  );
};

function describeResolution(res: string): string {
  const h = heightOf(res);
  return h >= 2000 ? 'UHD' : h >= 1000 ? 'Full HD' : h >= 700 ? 'HD' : h > 0 ? 'SD' : res;
}

function describe(s?: Status): string {
  switch (s?.state) {
    case 'live':
      return 'Live';
    case 'checking':
      return 'Checking…';
    case 'placeholder':
      return 'Off air';
    case 'dead':
    case 'refused':
      return 'Unavailable';
    case 'failed':
      return 'Stalled';
    default:
      return 'Not checked';
  }
}

const SourceRow = ({label, quality, status, guide, guideOk, preferred, onPress}: {label: string; quality: string; status: string; guide?: string; guideOk?: boolean; preferred: boolean; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  const good = status === 'Playing' || status === 'Live';
  return (
    <TouchableOpacity
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.srcRow, focused && styles.srcRowFocused]}>
      <View style={styles.srcMain}>
        <View style={styles.srcTop}>
          <Text style={[styles.srcLabel, focused && styles.dark]}>{label}</Text>
          <Text style={[styles.srcQuality, focused && styles.dark]}>{quality}</Text>
          <Text style={[styles.srcStatus, good && styles.ok, focused && styles.dark]}>{status}</Text>
        </View>
        {guide ? (
          <Text numberOfLines={1} style={[styles.srcGuide, guideOk === true && styles.ok, guideOk === false && styles.warn, focused && styles.dark]}>
            {`${guideOk === true ? '✓ ' : guideOk === false ? '✗ ' : ''}Its guide: ${guide}`}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: 'black'},
  center: {flex: 1, backgroundColor: brand.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 160},
  title: {color: brand.text, fontSize: type.title, fontWeight: '900', textAlign: 'center'},
  failNumber: {color: brand.textMuted, fontSize: type.heading, fontWeight: '900', marginBottom: 8},
  muted: {color: brand.textMuted, fontSize: type.body, marginTop: 12},
  actions: {flexDirection: 'row', marginTop: 30},
  panel: {position: 'absolute', top: 60, right: 60, bottom: 60, width: 720, backgroundColor: 'rgba(16,16,20,0.97)', borderRadius: 16, padding: 30, zIndex: 10},
  panelTitle: {color: brand.text, fontSize: type.heading, fontWeight: '900'},
  panelHint: {color: brand.textMuted, fontSize: type.small, marginTop: 6, marginBottom: 18},
  srcRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 8, marginBottom: 8, backgroundColor: brand.surface},
  srcRowFocused: {backgroundColor: brand.text},
  srcLabel: {color: brand.text, fontSize: type.body, fontWeight: '800', width: 170},
  srcQuality: {color: brand.textSoft, fontSize: type.small, width: 170},
  srcStatus: {color: brand.textMuted, fontSize: type.small, flex: 1, textAlign: 'right'},
  ok: {color: brand.match},
  warn: {color: '#ffb547'},
  srcMain: {flex: 1},
  srcTop: {flexDirection: 'row', alignItems: 'center'},
  srcGuide: {color: brand.textMuted, fontSize: type.tiny, marginTop: 4},
  dark: {color: '#000'},
});
