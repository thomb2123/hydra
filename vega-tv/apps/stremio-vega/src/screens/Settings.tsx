import React, {useEffect, useRef, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {FocusButton} from '../../../../shared/src/ui/FocusButton';
import {TextField} from '../../../../shared/src/ui/TextField';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {requestJson} from '../../../../shared/src/net';
import * as api from '../stremio/api';
import {normaliseServerUrl} from '../stremio/streaming';
import {StremioState} from '../state';

const CODE_LIFETIME_MS = 5 * 60 * 1000;
const POLL_MS = 3000;

export const Settings = ({state, onBack}: {state: StremioState; onBack: () => void}) => {
  const [mode, setMode] = useState<'menu' | 'code' | 'email'>('menu');
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

      <Text style={styles.heading}>Streaming server (your Windows PC)</Text>
      <Text style={styles.text}>
        Needed for torrent streams, YouTube and streams that require special headers. Enter the PC's local IP address, for example 192.168.1.20. Direct HTTP streams (e.g. debrid) work without it.
      </Text>
      <View style={styles.row}>
        <TextField label="PC address" value={server} onChangeText={setServer} onSubmit={testServer} placeholder="192.168.1.20" keyboardType="url" />
        <FocusButton label="Test & save" onPress={testServer} />
      </View>
      {serverStatus ? <Text style={styles.text}>{serverStatus}</Text> : null}
      <Text style={styles.muted}>Current: {state.server || 'not set'}</Text>

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
