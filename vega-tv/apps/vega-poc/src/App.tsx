// Vega TV proof of concept: verifies, on the real Fire TV stick, every platform
// behaviour the Stremio and FlixNest apps rely on. Each screen reports raw
// results so they can be photographed and compared with expectations.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, ScrollView, StyleSheet, Text, View} from 'react-native';
import {HWEvent, useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {FocusButton} from '../../../shared/src/ui/FocusButton';
import {colors, fonts, safeArea, spacing} from '../../../shared/src/ui/theme';
import {exitApp, useBackHandler} from '../../../shared/src/tv/remote';
import {VideoScreen} from '../../../shared/src/player/VideoScreen';
import {loadJson, saveJson} from '../../../shared/src/storage';
import {request} from '../../../shared/src/net';
import {PROBE_TYPES, TEST_VIDEOS, TestVideo} from './tests';

type Screen = 'home' | 'remote' | 'videos' | 'codecs' | 'network' | 'play';

const LAUNCH_KEY = 'vegapoc.launches';

export const App = () => {
  const [screen, setScreen] = useState<Screen>('home');
  const [video, setVideo] = useState<TestVideo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [launches, setLaunches] = useState<number | null>(null);

  const addLog = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`[vegapoc] ${line}`);
    setLog((previous) => [`${stamp} ${line}`, ...previous].slice(0, 60));
  }, []);

  useEffect(() => {
    loadJson<number>(LAUNCH_KEY, 0).then((count) => {
      const next = count + 1;
      setLaunches(next);
      saveJson(LAUNCH_KEY, next).then((ok) => addLog(`storage write ${ok ? 'ok' : 'FAILED'}; launch #${next}`));
    });
  }, [addLog]);

  if (screen === 'play' && video) {
    return (
      <VideoScreen
        source={video}
        onLog={(line) => addLog(`[player] ${line}`)}
        onExit={() => {
          setScreen('videos');
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Vega TV proof of concept</Text>
      <Text style={styles.subtitle}>
        Launch #{launches ?? '…'} (persists across restarts if storage works) · Fire TV OS 2.0 · React Native for Vega
      </Text>
      <View style={styles.body}>
        <View style={styles.column}>
          {screen === 'home' ? <Home go={setScreen} /> : null}
          {screen === 'remote' ? <RemoteTest onDone={() => setScreen('home')} addLog={addLog} /> : null}
          {screen === 'videos' ? (
            <VideoList
              onBack={() => setScreen('home')}
              onPlay={(item) => {
                setVideo(item);
                addLog(`play ${item.id}`);
                setScreen('play');
              }}
            />
          ) : null}
          {screen === 'codecs' ? <CodecProbe onBack={() => setScreen('home')} addLog={addLog} /> : null}
          {screen === 'network' ? <NetworkProbe onBack={() => setScreen('home')} addLog={addLog} /> : null}
        </View>
        <View style={styles.logPanel}>
          <Text style={styles.logTitle}>Diagnostics log (newest first)</Text>
          <ScrollView>
            {log.map((line, index) => (
              <Text key={index} style={styles.logLine}>
                {line}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const Home = ({go}: {go: (screen: Screen) => void}) => {
  useBackHandler(() => {
    exitApp();
    return true;
  });
  return (
    <View>
      <FocusButton label="1. Remote test" subtitle="Shows every key event the app receives" hasTVPreferredFocus onPress={() => go('remote')} />
      <FocusButton label="2. Test videos" subtitle="MP4, MKV, MPEG-TS, subtitles, HLS" onPress={() => go('videos')} />
      <FocusButton label="3. Codec probe" subtitle="canPlayType() for H.264/HEVC/AV1/VP9, AAC/AC-3/E-AC-3/DTS" onPress={() => go('codecs')} />
      <FocusButton label="4. Network & sign-in probe" subtitle="HTTPS, plain HTTP, cookies, FlixNest and Stremio APIs" onPress={() => go('network')} />
      <FocusButton label="Exit" onPress={exitApp} />
    </View>
  );
};

const RemoteTest = ({onDone, addLog}: {onDone: () => void; addLog: (line: string) => void}) => {
  const [events, setEvents] = useState<string[]>([]);
  const [backPresses, setBackPresses] = useState(0);
  useTVEventHandler((event: HWEvent) => {
    const line = `HW ${event.eventType} action=${String(event.eventKeyAction)}`;
    setEvents((previous) => [line, ...previous].slice(0, 14));
  });
  useBackHandler(() => {
    const next = backPresses + 1;
    setBackPresses(next);
    addLog(`hardwareBackPress #${next}`);
    if (next >= 2) {
      onDone();
    }
    return true;
  });
  return (
    <View>
      <Text style={styles.heading}>Remote test</Text>
      <Text style={styles.text}>Press every button: arrows, OK, play/pause, rewind, fast-forward, menu. Back twice returns.</Text>
      <Text style={styles.text}>Back presses seen by hardwareBackPress: {backPresses}</Text>
      <FocusButton label="Focusable button A" compact hasTVPreferredFocus onPress={() => addLog('button A pressed (onPress)')} />
      <FocusButton label="Focusable button B" compact onPress={() => addLog('button B pressed (onPress)')} />
      {events.map((line, index) => (
        <Text key={index} style={styles.mono}>
          {line}
        </Text>
      ))}
    </View>
  );
};

const VideoList = ({onBack, onPlay}: {onBack: () => void; onPlay: (item: TestVideo) => void}) => {
  useBackHandler(() => {
    onBack();
    return true;
  });
  return (
    <View style={styles.flex}>
      <Text style={styles.heading}>Test videos</Text>
      <FlatList
        data={TEST_VIDEOS}
        keyExtractor={(item) => item.id}
        renderItem={({item, index}) => (
          <FocusButton label={item.title} subtitle={item.expectation} hasTVPreferredFocus={index === 0} onPress={() => onPlay(item)} />
        )}
      />
    </View>
  );
};

const CodecProbe = ({onBack, addLog}: {onBack: () => void; addLog: (line: string) => void}) => {
  const [rows, setRows] = useState<string[]>(['Running…']);
  useBackHandler(() => {
    onBack();
    return true;
  });
  useEffect(() => {
    let cancelled = false;
    const player = new VideoPlayer();
    player
      .initialize()
      .then(() => {
        const out = PROBE_TYPES.map((type) => {
          let answer = '';
          try {
            answer = String(player.canPlayType(type) || '""');
          } catch (e: any) {
            answer = `threw ${e?.message || e}`;
          }
          return `${answer.padEnd(9)} ${type}`;
        });
        if (!cancelled) {
          setRows(out);
          out.forEach((row) => addLog(`codec ${row}`));
        }
      })
      .catch((e: any) => !cancelled && setRows([`initialize failed: ${e?.message || e}`]))
      .finally(() => {
        player.deinitialize().catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [addLog]);
  return (
    <View>
      <Text style={styles.heading}>Codec probe (canPlayType)</Text>
      <Text style={styles.text}>"probably"/"maybe" = supported, empty = not supported.</Text>
      <FocusButton label="Back" compact hasTVPreferredFocus onPress={onBack} />
      {rows.map((row, index) => (
        <Text key={index} style={styles.mono}>
          {row}
        </Text>
      ))}
    </View>
  );
};

type Probe = {name: string; run: () => Promise<string>};

const NetworkProbe = ({onBack, addLog}: {onBack: () => void; addLog: (line: string) => void}) => {
  const [results, setResults] = useState<string[]>([]);
  const running = useRef(false);
  useBackHandler(() => {
    onBack();
    return true;
  });

  const probes: Probe[] = [
    {
      name: 'HTTPS JSON (Stremio Cinemeta add-on)',
      run: async () => {
        const r = await request('https://v3-cinemeta.strem.io/manifest.json');
        return `HTTP ${r.status}, ${r.text.length} bytes`;
      },
    },
    {
      name: 'Stremio API (default add-on collection)',
      run: async () => {
        const r = await request('https://api.strem.io/api/addonCollectionGet', {
          method: 'POST',
          body: {type: 'AddonCollectionGet', authKey: '', update: true},
        });
        const count = (JSON.parse(r.text)?.result?.addons || []).length;
        return `HTTP ${r.status}, ${count} add-ons`;
      },
    },
    {
      name: 'FlixNest API (/webplayer/api/info)',
      run: async () => {
        const r = await request('https://player.flixnest.app/webplayer/api/info');
        return `HTTP ${r.status}, ${r.text.slice(0, 60)}…`;
      },
    },
    {
      name: 'Plain HTTP (cleartext, needed for a LAN Stremio server)',
      run: async () => {
        const r = await request('http://example.com/', {headers: {Accept: 'text/html'}});
        return `HTTP ${r.status}, ${r.text.length} bytes`;
      },
    },
    {
      name: 'Cookie jar: set cookie',
      run: async () => {
        const r = await request('https://httpbin.org/cookies/set?vegatv=1', {headers: {Accept: 'application/json'}});
        return `HTTP ${r.status}; set-cookie visible to JS: ${r.headers['set-cookie'] ? 'yes' : 'no'}`;
      },
    },
    {
      name: 'Cookie jar: cookie sent back automatically?',
      run: async () => {
        const r = await request('https://httpbin.org/cookies');
        return `HTTP ${r.status}; server saw ${r.text.replace(/\s+/g, ' ').slice(0, 80)}`;
      },
    },
  ];

  const runAll = async () => {
    if (running.current) {
      return;
    }
    running.current = true;
    setResults([]);
    for (const probe of probes) {
      let line: string;
      try {
        line = `OK   ${probe.name}: ${await probe.run()}`;
      } catch (e: any) {
        line = `FAIL ${probe.name}: ${e?.message || e}`;
      }
      addLog(line);
      setResults((previous) => [...previous, line]);
    }
    running.current = false;
  };

  return (
    <View>
      <Text style={styles.heading}>Network & sign-in probe</Text>
      <FocusButton label="Run all probes" compact hasTVPreferredFocus onPress={runAll} />
      <FocusButton label="Back" compact onPress={onBack} />
      {results.map((line, index) => (
        <Text key={index} style={[styles.mono, line.startsWith('FAIL') ? styles.fail : null]}>
          {line}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background, paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '700'},
  subtitle: {color: colors.textMuted, fontSize: fonts.small, marginBottom: spacing.m},
  body: {flex: 1, flexDirection: 'row'},
  column: {flex: 3, marginRight: spacing.l},
  flex: {flex: 1},
  heading: {color: colors.text, fontSize: fonts.heading, fontWeight: '700', marginBottom: spacing.s},
  text: {color: colors.text, fontSize: fonts.small, marginBottom: spacing.s},
  mono: {color: colors.text, fontSize: 19, fontFamily: 'monospace'},
  fail: {color: colors.danger},
  logPanel: {flex: 2, backgroundColor: colors.surface, borderRadius: 14, padding: spacing.m},
  logTitle: {color: colors.textMuted, fontSize: fonts.small, marginBottom: spacing.s},
  logLine: {color: colors.text, fontSize: 17, fontFamily: 'monospace'},
});
