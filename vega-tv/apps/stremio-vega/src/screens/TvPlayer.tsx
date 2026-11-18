// Plays a merged channel like a TV box: on tune it checks the best-ranked
// sources in parallel (placeholders such as "Maintenance"/black screens and
// dead links are skipped), plays the best live one, falls back if it stalls,
// remembers what works, zaps with ▲/▼, and ☰ opens "Sources" to pick by hand.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {PlaySource, VideoScreen} from '../../../../shared/src/player/VideoScreen';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {Pill} from '../ui/Cards';
import {brand, type} from '../ui/brand';
import * as fx from '../tv/flixnest';
import {MergedChannel, Source} from '../tv/channels';
import {cleanTitle, nowNext, timeRange} from '../tv/epg';
import {recordResult} from '../tv/guide';
import {ProbeResult, probeStream} from '../tv/probe';

export interface TvPlayerProps {
  access: fx.Access;
  list: MergedChannel[];
  index: number;
  /** For sport events without a curated channel: play these feeds directly. */
  feeds?: Source[];
  title?: string;
  onExit: () => void;
  onRanked?: () => void;
  log?: (line: string) => void;
}

type Status = {state: 'checking' | 'live' | 'placeholder' | 'dead' | 'failed' | 'refused'; url?: string; mime?: string; resolution?: string};

const START_TIMEOUT_MS = 10000;
const BATCH = 3;

const qualityLabel = (q: number) => (q >= 4 ? 'UHD' : q >= 3 ? 'Full HD' : q >= 2 ? 'HD' : 'SD');

export const TvPlayer = ({access, list, index: startIndex, feeds, title, onExit, onRanked, log = () => undefined}: TvPlayerProps) => {
  const [index, setIndex] = useState(startIndex);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [playing, setPlaying] = useState<Source | null>(null);
  const [source, setSource] = useState<PlaySource | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [guide, setGuide] = useState('');
  const gen = useRef(0);
  const statusRef = useRef(statuses);
  statusRef.current = statuses;

  const channel: MergedChannel | undefined = list[index];
  const sources: Source[] = feeds && feeds.length ? feeds : channel?.sources || [];
  const name = title || channel?.name || 'Live TV';

  const setStatus = (id: string, s: Status) => setStatuses((prev) => ({...prev, [id]: s}));

  /** Resolves the stream for one source and checks it is really live. */
  const check = useCallback(
    async (s: Source, g: number): Promise<Status> => {
      setStatus(s.id, {state: 'checking'});
      let result: Status;
      try {
        const stream = await fx.play(access, s.id);
        const probe: ProbeResult = await probeStream(stream.url);
        result = {state: probe.state, url: stream.url, mime: stream.mime, resolution: probe.resolution};
        if (probe.state !== 'live') {
          log(`tv ${name}: ${s.provider} ${probe.state} (${probe.why || ''})`);
          recordResult(s, false).catch(() => undefined);
        }
      } catch (e: any) {
        if (fx.needsSignIn(e)) {
          throw e;
        }
        result = {state: 'refused'};
        recordResult(s, false).catch(() => undefined);
      }
      if (g === gen.current) {
        setStatus(s.id, result);
      }
      return result;
    },
    [access, log, name],
  );

  const start = useCallback(
    (s: Source, st: Status) => {
      setPlaying(s);
      setFailure(null);
      setSource({
        url: st.url!,
        mime: st.mime || 'application/vnd.apple.mpegurl',
        title: name,
        subtitle: guide || undefined,
        detail: qualityLabel(s.quality),
        live: true,
        startTimeoutMs: START_TIMEOUT_MS,
      });
    },
    [guide, name],
  );

  /** Automatic choice: best-ranked source that is actually live, checked a few at a time. */
  const tune = useCallback(
    async (skip: Set<string>) => {
      const g = ++gen.current;
      setSource(null);
      setPanel(false);
      const queue = sources.filter((s) => !skip.has(s.id));
      try {
        for (let i = 0; i < queue.length; i += BATCH) {
          const batch = queue.slice(i, i + BATCH);
          const results = await Promise.all(batch.map((s) => check(s, g)));
          if (g !== gen.current) {
            return;
          }
          const pick = batch.findIndex((_, k) => results[k].state === 'live');
          if (pick >= 0) {
            log(`tv ${name}: playing source ${sources.indexOf(batch[pick]) + 1}/${sources.length} (${batch[pick].provider})`);
            start(batch[pick], results[pick]);
            return;
          }
        }
        setFailure(`${name} isn't on air from any source right now.`);
      } catch (e: any) {
        if (fx.needsSignIn(e)) {
          setFailure('Your FlixNest sign-in has expired. Go back to Live TV to pair this TV again.');
        } else {
          setFailure(`Couldn't tune ${name}: ${e?.message || e}`);
        }
      }
    },
    [check, log, name, sources, start],
  );

  // New channel: load its guide line and tune automatically.
  useEffect(() => {
    setStatuses({});
    setPlaying(null);
    setGuide('');
    if (channel && !feeds) {
      nowNext(access, channel)
        .then((info) => setGuide(info?.now?.title ? `${timeRange(info.now)}  ${cleanTitle(info.now.title)}` : ''))
        .catch(() => undefined);
    }
    tune(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const onFailed = useCallback(
    (reason: string) => {
      if (!playing) {
        return;
      }
      log(`tv ${name}: ${playing.provider} stalled (${reason}); trying the next source`);
      recordResult(playing, false).catch(() => undefined);
      setStatus(playing.id, {...(statusRef.current[playing.id] || {}), state: 'failed'});
      const bad = new Set(Object.entries(statusRef.current).filter(([, s]) => s.state !== 'live').map(([id]) => id));
      bad.add(playing.id);
      tune(bad);
    },
    [log, name, playing, tune],
  );

  const onStarted = useCallback(() => {
    if (playing) {
      recordResult(playing, true)
        .then(() => onRanked?.())
        .catch(() => undefined);
    }
  }, [onRanked, playing]);

  const zap = useCallback(
    (step: number) => {
      if (feeds || list.length < 2) {
        return;
      }
      setIndex((i) => (i + step + list.length) % list.length);
    },
    [feeds, list.length],
  );

  const choose = useCallback(
    async (s: Source) => {
      const g = ++gen.current;
      setPanel(false);
      setSource(null);
      const known = statusRef.current[s.id];
      const st = known && known.state === 'live' && known.url ? known : await check(s, g).catch(() => ({state: 'refused'}) as Status);
      if (g !== gen.current) {
        return;
      }
      if (st.state === 'live') {
        start(s, st);
      } else {
        setFailure(`That source is ${st.state === 'placeholder' ? 'showing a placeholder' : 'not available'} right now.`);
      }
    },
    [check, start],
  );

  useBackHandler(() => {
    if (panel) {
      setPanel(false);
      return true;
    }
    if (!source) {
      onExit();
      return true;
    }
    return false;
  });

  const sourcesPanel = panel ? (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Sources · {name}</Text>
      <Text style={styles.panelHint}>Chosen automatically. Pick another if this one looks wrong.</Text>
      <FlatList
        data={sources}
        keyExtractor={(s) => s.id}
        renderItem={({item, index: i}) => (
          <SourceRow
            label={`Source ${i + 1}`}
            quality={statuses[item.id]?.resolution || qualityLabel(item.quality)}
            status={item.id === playing?.id ? 'Playing' : describe(statuses[item.id])}
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
        <Text style={styles.title}>{failure}</Text>
        <View style={styles.actions}>
          <Pill label="Try again" primary hasTVPreferredFocus onPress={() => tune(new Set())} />
          {sources.length > 1 ? <Pill label="Sources" onPress={() => { setFailure(null); setPanel(true); }} /> : null}
          {!feeds && list.length > 1 ? <Pill label="Next channel" onPress={() => zap(1)} /> : null}
          <Pill label="Back to guide" onPress={onExit} />
        </View>
      </View>
    );
  }
  if (!source) {
    const checked = Object.values(statuses).filter((s) => s.state !== 'checking').length;
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{name}</Text>
        {guide ? <Text style={styles.guide}>{guide}</Text> : null}
        <Text style={styles.muted}>{checked ? `Finding the best working source… (${checked}/${sources.length} checked)` : 'Tuning…'}</Text>
        {sourcesPanel}
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <VideoScreen
        key={`${index}:${playing?.id}:${source.url}`}
        source={source}
        onExit={onExit}
        onLog={log}
        onFailed={onFailed}
        onStarted={onStarted}
        onZap={feeds ? undefined : zap}
        onMenu={sources.length > 1 ? () => setPanel(true) : undefined}
        inputLocked={panel}
      />
      {sourcesPanel}
    </View>
  );
};

function describe(s?: Status): string {
  switch (s?.state) {
    case 'live':
      return 'Live';
    case 'checking':
      return 'Checking…';
    case 'placeholder':
      return 'Off air (placeholder)';
    case 'dead':
    case 'refused':
      return 'Unavailable';
    case 'failed':
      return 'Stalled';
    default:
      return 'Not checked';
  }
}

const SourceRow = ({label, quality, status, preferred, onPress}: {label: string; quality: string; status: string; preferred: boolean; onPress: () => void}) => {
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
      <Text style={[styles.srcLabel, focused && styles.dark]}>{label}</Text>
      <Text style={[styles.srcQuality, focused && styles.dark]}>{quality}</Text>
      <Text style={[styles.srcStatus, good && styles.ok, focused && styles.dark]}>{status}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: 'black'},
  center: {flex: 1, backgroundColor: brand.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 160},
  title: {color: brand.text, fontSize: type.title, fontWeight: '900', textAlign: 'center'},
  guide: {color: brand.textSoft, fontSize: type.body, marginTop: 10},
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
  dark: {color: '#000'},
});
