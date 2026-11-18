import React, {useEffect, useRef, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {FocusButton} from '../../../../shared/src/ui/FocusButton';
import {TextField} from '../../../../shared/src/ui/TextField';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {requestJson} from '../../../../shared/src/net';
import * as api from '../stremio/api';
import {normaliseServerUrl} from '../stremio/streaming';
import {STICK_ONLY, StremioState, SUBTITLE_SIZES, SubtitleSize} from '../state';
import {TvState} from '../tv/useTv';
import {TvConnect} from './TvGuide';
import {resetReliability} from '../tv/guide';

const SIZE_LABEL: Record<SubtitleSize, string> = {smaller: 'Smaller', standard: 'Standard', larger: 'Larger'};

const CODE_LIFETIME_MS = 5 * 60 * 1000;
const POLL_MS = 3000;

export const Settings = ({state, tv, onBack}: {state: StremioState; tv: TvState; onBack: () => void}) => {
  const [mode, setMode] = useState<'menu' | 'code' | 'email'>('menu');
  const [pairing, setPairing] = useState(false);
  const [tvNote, setTvNote] = useState<string | null>(null);
  const [server, setServer] = useState(state.server.replace(/^http:\/\//, ''));
  const [serverStatus, setServerStatus] = useState<string | null>(null);

  useBackHandler(() => {
    if (mode !== 'menu') {
      setMode('menu');
    } else {
      onBack();
    }
    return true;
  });

  const testServer = async () => {
    const url = normaliseServerUrl(server);
    if (!url) {
      await state.setServer('');
      setServerStatus('Streaming server cleared. Torrent streams will be unavailable.');
      return;
    }
    setServerStatus(`Testing ${url} …`);
    try {
      const settings = await requestJson<any>(`${url}/settings`, {timeoutMs: 8000});
      const version = settings?.values?.serverVersion || settings?.serverVersion || 'unknown version';
      await state.setServer(url);
      setServerStatus(`Connected to the Stremio streaming server (${version}). Saved.`);
    } catch (e: any) {
      setServerStatus(
        `Could not reach ${url}: ${e?.message || e}. Check the PC is on, Stremio (or Stremio Service) is running, and Windows Firewall allows port 11470 on private networks.`,
      );
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.heading}>Stremio account</Text>
      {state.session ? (
        <View>
          <Text style={styles.text}>Signed in as {state.session.email}. Your add-ons and library come from this account.</Text>
          <View style={styles.row}>
            <FocusButton label="Reload add-ons & library" hasTVPreferredFocus onPress={() => state.refresh()} />
            <FocusButton label="Sign out" onPress={() => state.signOut()} />
          </View>
        </View>
      ) : mode === 'code' ? (
        <LinkCodeSignIn state={state} onDone={() => setMode('menu')} />
      ) : mode === 'email' ? (
        <EmailSignIn state={state} onDone={() => setMode('menu')} />
      ) : (
        <View>
          <Text style={styles.text}>Not signed in: the default Stremio add-ons are used. Sign in to load your own add-ons and library.</Text>
          <View style={styles.row}>
            <FocusButton label="Sign in with a code (phone)" subtitle="Recommended: no typing on the TV" hasTVPreferredFocus onPress={() => setMode('code')} />
            <FocusButton label="Sign in with email" subtitle="Uses the on-screen keyboard" onPress={() => setMode('email')} />
          </View>
        </View>
      )}

      <Text style={styles.heading}>Start-up</Text>
      <View style={styles.row}>
        <FocusButton
          label={`Open on: ${state.startTab === 'tv' ? 'Live TV' : 'Home'}`}
          subtitle="Press to change"
          onPress={() => state.setStartTab(state.startTab === 'tv' ? 'home' : 'tv')}
        />
      </View>

      <Text style={styles.heading}>Subtitles</Text>
      <View style={styles.row}>
        <FocusButton
          label={`Size: ${SIZE_LABEL[state.subtitleSize]}`}
          subtitle="Press to change"
          onPress={() => state.setSubtitleSize(SUBTITLE_SIZES[(SUBTITLE_SIZES.indexOf(state.subtitleSize) + 1) % SUBTITLE_SIZES.length])}
        />
      </View>
      <Text style={styles.muted}>
        {state.subtitleLanguage ? `Subtitles turn on by themselves in the language you last chose (${state.subtitleLanguage}).` : 'Subtitles start off; choosing a language while watching makes it the default.'}
      </Text>

      <Text style={styles.heading}>Live TV (FlixNest)</Text>
      {pairing ? (
        <View style={styles.pairBox}>
          <TvConnect tv={tv} onDone={() => { setPairing(false); setTvNote('Connected. Your channel list is being refreshed.'); }} />
          <FocusButton label="Cancel" compact onPress={() => setPairing(false)} />
        </View>
      ) : (
        <View>
          <Text style={styles.text}>
            {tv.access
              ? `Connected. ${tv.guide ? `${tv.guide.channels.length} channels, list updated ${new Date(tv.guide.builtAt).toLocaleString()}.` : 'Channel list not built yet.'}${tv.building ? ' Updating now…' : ''}`
              : 'Not connected. Live TV needs your FlixNest account (approve a code on your phone).'}
          </Text>
          <View style={styles.row}>
            <FocusButton label={tv.access ? 'Reconnect (new code)' : 'Connect FlixNest'} subtitle="Approve a code on your phone" onPress={() => setPairing(true)} />
            {tv.access ? <FocusButton label="Refresh channel list" subtitle="Re-reads every provider" onPress={() => { setTvNote('Refreshing channels…'); tv.rebuild().then(() => setTvNote('Channel list refreshed.')); }} /> : null}
            {tv.access ? <FocusButton label="Reset source choices" subtitle="Forget which sources failed" onPress={() => resetReliability().then(() => tv.refreshRanking()).then(() => setTvNote('Source history cleared.'))} /> : null}
            {tv.access ? <FocusButton label="Sign out of FlixNest" compact onPress={() => tv.disconnect().then(() => setTvNote('Signed out of FlixNest on this TV.'))} /> : null}
          </View>
          {tvNote ? <Text style={styles.muted}>{tvNote}</Text> : null}
          <Text style={styles.muted}>Live TV runs entirely on this stick; your PC is not needed for it.</Text>
        </View>
      )}

      {STICK_ONLY ? (
        <>
          <Text style={styles.heading}>Runs on this stick</Text>
          <Text style={styles.text}>
            Films, series, subtitles and live TV all run on this stick: no PC is needed, so it works on any Wi-Fi. Films come from your debrid service only (torrents are switched off, so your IP address is never shared with torrent peers).
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.heading}>Streaming server (your Windows PC)</Text>
          <Text style={styles.text}>Optional: used to check files before playing and for some subtitles.</Text>
          <View style={styles.row}>
            <TextField label="PC address" value={server} onChangeText={setServer} onSubmit={testServer} placeholder="192.168.1.20" keyboardType="url" />
            <FocusButton label="Test & save" onPress={testServer} />
          </View>
          {serverStatus ? <Text style={styles.text}>{serverStatus}</Text> : null}
          <Text style={styles.muted}>Current: {state.server || 'not set'}</Text>
        </>
      )}

      <View style={styles.row}>
        <FocusButton label="Back" compact onPress={onBack} />
      </View>
    </ScrollView>
  );
};

const LinkCodeSignIn = ({state, onDone}: {state: StremioState; onDone: () => void}) => {
  const [code, setCode] = useState<api.LinkCode | null>(null);
  const [status, setStatus] = useState('Getting a code…');
  const generation = useRef(0);
  // Refs keep the polling loop stable: `state` is a new object on every render.
  const signInRef = useRef(state.signIn);
  const onDoneRef = useRef(onDone);
  signInRef.current = state.signIn;
  onDoneRef.current = onDone;

  useEffect(() => {
    const current = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = async () => {
      try {
        const next = await api.createLinkCode();
        if (current !== generation.current) {
          return;
        }
        setCode(next);
        setStatus('Waiting for approval on your phone…');
        const expires = Date.now() + CODE_LIFETIME_MS;
        const poll = async () => {
          if (current !== generation.current) {
            return;
          }
          if (Date.now() > expires) {
            start();
            return;
          }
          try {
            const authKey = await api.readLinkCode(next.code);
            if (authKey && current === generation.current) {
              setStatus('Approved. Loading your add-ons…');
              await signInRef.current(authKey);
              onDoneRef.current();
              return;
            }
          } catch {
            // Network hiccup: keep polling.
          }
          timer = setTimeout(poll, POLL_MS);
        };
        timer = setTimeout(poll, POLL_MS);
      } catch (e: any) {
        setStatus(`Could not get a code: ${e?.message || e}`);
      }
    };
    start();
    return () => {
      generation.current += 1;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <View style={styles.codeBox}>
      {code ? <Image source={{uri: code.qrcode}} style={styles.qr} resizeMode="contain" /> : null}
      <View style={styles.flex}>
        <Text style={styles.text}>On your phone or PC, open</Text>
        <Text style={styles.code}>{code ? code.link : '…'}</Text>
        <Text style={styles.text}>or scan the QR code, sign in to Stremio there and approve this TV.</Text>
        <Text style={styles.text}>Code: {code ? code.code : '…'}</Text>
        <Text style={styles.muted}>{status}</Text>
        <FocusButton label="Cancel" compact hasTVPreferredFocus onPress={onDone} />
      </View>
    </View>
  );
};

const EmailSignIn = ({state, onDone}: {state: StremioState; onDone: () => void}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const submit = async () => {
    setStatus('Signing in…');
    try {
      const session = await api.login(email.trim(), password);
      setPassword('');
      await state.signIn(session.authKey, session.user?.email || email.trim());
      onDone();
    } catch (e: any) {
      setStatus(`Sign-in failed: ${e?.message || e}`);
    }
  };
  return (
    <View>
      <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" hasTVPreferredFocus />
      <TextField label="Password" value={password} onChangeText={setPassword} secure onSubmit={submit} />
      <View style={styles.row}>
        <FocusButton label="Sign in" onPress={submit} />
        <FocusButton label="Cancel" compact onPress={onDone} />
      </View>
      {status ? <Text style={styles.text}>{status}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  pairBox: {height: 520},
  root: {flex: 1, backgroundColor: colors.background},
  content: {paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '800'},
  heading: {color: colors.text, fontSize: fonts.heading, fontWeight: '700', marginTop: spacing.l, marginBottom: spacing.s},
  text: {color: colors.text, fontSize: fonts.small, marginVertical: spacing.xs, maxWidth: 1400},
  muted: {color: colors.textMuted, fontSize: fonts.small, marginVertical: spacing.xs},
  row: {flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap'},
  codeBox: {flexDirection: 'row', alignItems: 'center'},
  qr: {width: 300, height: 300, marginRight: spacing.l, backgroundColor: 'white', borderRadius: 12},
  code: {color: colors.focus, fontSize: fonts.title, fontWeight: '800'},
  flex: {flex: 1},
});
