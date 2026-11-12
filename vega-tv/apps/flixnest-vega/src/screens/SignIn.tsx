import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {FocusButton} from '../../../../shared/src/ui/FocusButton';
import {TextField} from '../../../../shared/src/ui/TextField';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {exitApp, useBackHandler} from '../../../../shared/src/tv/remote';
import {Access, accessIsValid, formatPairCode, normalisePairCode, pairUrl} from '../flixnest/api';
import {QrCode} from '../QrCode';
import {FlixState} from '../state';

type Method = 'pair' | 'account' | 'xtream' | 'playlist';

export const SignIn = ({state}: {state: FlixState}) => {
  const [method, setMethod] = useState<Method>('pair');
  useBackHandler(() => {
    if (method !== 'pair') {
      setMethod('pair');
    } else {
      exitApp();
    }
    return true;
  });
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>FlixNest</Text>
      <Text style={styles.muted}>Sign in with your existing Flix-Streams access. Unofficial Vega client.</Text>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      <View style={styles.tabs}>
        <FocusButton compact label="Phone sign-in" selected={method === 'pair'} onPress={() => setMethod('pair')} hasTVPreferredFocus />
        <FocusButton compact label="Email & password" selected={method === 'account'} onPress={() => setMethod('account')} />
        <FocusButton compact label="Xtream server" selected={method === 'xtream'} onPress={() => setMethod('xtream')} />
        <FocusButton compact label="Playlist URL" selected={method === 'playlist'} onPress={() => setMethod('playlist')} />
      </View>
      {method === 'pair' ? <PairPanel state={state} /> : null}
      {method === 'account' ? <AccountForm state={state} /> : null}
      {method === 'xtream' ? <XtreamForm state={state} /> : null}
      {method === 'playlist' ? <PlaylistForm state={state} /> : null}
    </ScrollView>
  );
};

const PairPanel = ({state}: {state: FlixState}) => {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('Requesting a code…');
  const generation = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const current = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deviceCode = '';
    const start = async (renewals: number) => {
      if (renewals > 5) {
        setStatus('Code expired. Leave and reopen this screen for a new one.');
        return;
      }
      try {
        const result = await stateRef.current.client.pairStart();
        if (current !== generation.current) {
          stateRef.current.client.pairCancel(result.device_code);
          return;
        }
        deviceCode = String(result.device_code || '');
        setCode(normalisePairCode(result.code) || String(result.code || ''));
        const expires = Date.now() + Number(result.expires_in || 600) * 1000;
        const interval = Math.max(2, Number(result.interval) || 3) * 1000;
        setStatus('Waiting for approval on your phone…');
        const poll = async () => {
          if (current !== generation.current) {
            return;
          }
          if (Date.now() > expires) {
            start(renewals + 1);
            return;
          }
          try {
            const answer = await stateRef.current.client.pairPoll(deviceCode);
            if (answer.status === 'approved' && accessIsValid(answer.access)) {
              setStatus('Approved. Connecting…');
              const ok = await stateRef.current.connect(answer.access as Access);
              if (!ok) {
                setStatus('Approved, but connecting failed. See the message above.');
              }
              return;
            }
          } catch (e: any) {
            if (e?.code === 'pair_expired') {
              start(renewals + 1);
              return;
            }
            setStatus('Reconnecting…');
          }
          timer = setTimeout(poll, interval);
        };
        timer = setTimeout(poll, interval);
      } catch (e: any) {
        setStatus(`Phone sign-in is unavailable: ${e?.message || e}`);
      }
    };
    start(0);
    return () => {
      generation.current += 1;
      if (timer) {
        clearTimeout(timer);
      }
      if (deviceCode) {
        stateRef.current.client.pairCancel(deviceCode);
      }
    };
  }, []);

  return (
    <View style={styles.pair}>
      {code ? <QrCode text={pairUrl(code)} size={320} /> : <View style={styles.qrPlaceholder} />}
      <View style={styles.flex}>
        <Text style={styles.text}>Scan the code with your phone, or open</Text>
        <Text style={styles.link}>player.flixnest.app/webplayer/pair</Text>
        <Text style={styles.text}>and enter</Text>
        <Text style={styles.code}>{code ? formatPairCode(code) : '…'}</Text>
        <Text style={styles.text}>Confirm with your FlixNest access on the phone. This TV then signs in by itself.</Text>
        <Text style={styles.muted}>{status}</Text>
      </View>
    </View>
  );
};

const AccountForm = ({state}: {state: FlixState}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const submit = async () => {
    setStatus('Signing in…');
    try {
      const result = await state.client.accountLogin(email.trim(), password);
      setPassword('');
      if (!accessIsValid(result.access)) {
        throw new Error('Unexpected sign-in response.');
      }
      const ok = await state.connect(result.access);
      setStatus(ok ? null : 'Signed in, but connecting failed.');
    } catch (e: any) {
      setStatus(`Sign-in failed: ${e?.message || e}`);
    }
  };
  return (
    <View>
      <TextField label="Flix-Streams email" value={email} onChangeText={setEmail} keyboardType="email-address" hasTVPreferredFocus />
      <TextField label="Password" value={password} onChangeText={setPassword} secure onSubmit={submit} />
      <FocusButton label="Sign in and watch" onPress={submit} />
      {status ? <Text style={styles.text}>{status}</Text> : null}
    </View>
  );
};

const XtreamForm = ({state}: {state: FlixState}) => {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const submit = async () => {
    const access: Access = {type: 'xtream', url: url.trim(), username, password};
    if (!accessIsValid(access)) {
      setStatus('Enter a server URL starting with http:// or https://.');
      return;
    }
    setStatus('Connecting…');
    const ok = await state.connect(access);
    setStatus(ok ? null : 'Connection failed.');
  };
  return (
    <View>
      <TextField label="Server URL" value={url} onChangeText={setUrl} keyboardType="url" hasTVPreferredFocus />
      <TextField label="Username" value={username} onChangeText={setUsername} />
      <TextField label="Password" value={password} onChangeText={setPassword} secure onSubmit={submit} />
      <FocusButton label="Connect" onPress={submit} />
      {status ? <Text style={styles.text}>{status}</Text> : null}
    </View>
  );
};

const PlaylistForm = ({state}: {state: FlixState}) => {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const submit = async () => {
    const access: Access = {type: 'playlist', url: url.trim()};
    if (!accessIsValid(access)) {
      setStatus('Enter the playlist link from your Flix-Streams account.');
      return;
    }
    setStatus('Connecting…');
    const ok = await state.connect(access);
    setStatus(ok ? null : 'Connection failed.');
  };
  return (
    <View>
      <TextField label="Playlist URL" value={url} onChangeText={setUrl} keyboardType="url" hasTVPreferredFocus onSubmit={submit} />
      <FocusButton label="Connect" onPress={submit} />
      {status ? <Text style={styles.text}>{status}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  content: {paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '800'},
  tabs: {flexDirection: 'row', marginVertical: spacing.m},
  pair: {flexDirection: 'row', alignItems: 'center'},
  qrPlaceholder: {width: 320, height: 320, backgroundColor: colors.surface, borderRadius: 12},
  flex: {flex: 1, marginLeft: spacing.xl},
  text: {color: colors.text, fontSize: fonts.body, marginVertical: spacing.xs},
  link: {color: colors.focus, fontSize: fonts.body, fontWeight: '700'},
  code: {color: colors.focus, fontSize: 72, fontWeight: '800', letterSpacing: 6, marginVertical: spacing.s},
  muted: {color: colors.textMuted, fontSize: fonts.small, marginVertical: spacing.xs},
  error: {color: colors.danger, fontSize: fonts.body, marginVertical: spacing.xs},
});
