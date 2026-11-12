import React, {useEffect, useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {FocusButton} from '../../../../shared/src/ui/FocusButton';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {PlaySource} from '../../../../shared/src/player/VideoScreen';
import {StreamGroup, fetchStreams} from '../stremio/addons';
import {describeStream} from '../stremio/streaming';
import {prepareSource, videoIdOf} from '../stremio/playback';
import {analyseStream, summarise} from '../stremio/streamPicker';
import {MetaDetail, Stream, Video} from '../stremio/types';
import {StremioState} from '../state';

export interface StreamsProps {
  state: StremioState;
  meta: MetaDetail;
  video: Video | null;
  onPlay: (source: PlaySource, metaId: string, videoId: string) => void;
  onBack: () => void;
}

type Row = {key: string; header?: string; stream?: Stream; addonName?: string; error?: string};

export const Streams = ({state, meta, video, onPlay, onBack}: StreamsProps) => {
  const videoId = videoIdOf(meta, video);
  const [groups, setGroups] = useState<StreamGroup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useBackHandler(() => {
    onBack();
    return true;
  });

  useEffect(() => {
    let alive = true;
    fetchStreams(state.addons, meta.type, videoId).then((result) => alive && setGroups(result));
    return () => {
      alive = false;
    };
  }, [state.addons, meta.type, videoId]);

  const rows = useMemo<Row[]>(() => {
    if (!groups) {
      return [];
    }
    const out: Row[] = [];
    for (const group of groups) {
      out.push({key: `h-${group.addon.transportUrl}`, header: group.addon.manifest.name, error: group.error});
      group.streams.forEach((stream, index) => {
        out.push({key: `${group.addon.transportUrl}-${index}`, stream, addonName: group.addon.manifest.name});
      });
    }
    return out;
  }, [groups]);

  const choose = async (stream: Stream) => {
    setMessage(null);
    setBusy('Preparing stream…');
    try {
      const traits = analyseStream(stream);
      onPlay(await prepareSource(state, meta, video, stream, summarise(traits) || describeStream(stream).title), meta.id, videoId);
    } catch (e: any) {
      setMessage(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const firstStreamKey = rows.find((row) => row.stream)?.key;
  return (
    <View style={styles.root}>
      <Text style={styles.title} numberOfLines={1}>
        {meta.name}
        {video ? ` · ${video.season != null ? `S${video.season}E${video.episode} ` : ''}${video.title || video.name || ''}` : ''}
      </Text>
      <Text style={styles.muted}>
        {state.server ? `Streaming server: ${state.server}` : 'No streaming server set: torrent streams need the Stremio server on your PC.'}
      </Text>
      {busy ? <Text style={styles.busy}>{busy}</Text> : null}
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {!groups ? <Text style={styles.muted}>Asking your add-ons for streams…</Text> : null}
      {groups && rows.length === 0 ? (
        <View>
          <Text style={styles.muted}>None of your add-ons provide streams for this title. Install stream add-ons in your Stremio account.</Text>
          <FocusButton label="Back" hasTVPreferredFocus onPress={onBack} />
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({item}) => {
          if (item.header !== undefined) {
            return (
              <Text style={styles.group}>
                {item.header}
                {item.error ? ` · failed: ${item.error}` : ''}
              </Text>
            );
          }
          const stream = item.stream as Stream;
          const label = describeStream(stream);
          return (
            <FocusButton
              label={label.title}
              subtitle={label.detail}
              hasTVPreferredFocus={item.key === firstStreamKey}
              disabled={!!busy}
              onPress={() => choose(stream)}
            />
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background, paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '800'},
  muted: {color: colors.textMuted, fontSize: fonts.small, marginVertical: spacing.xs},
  busy: {color: colors.focus, fontSize: fonts.body, marginVertical: spacing.xs},
  error: {color: colors.danger, fontSize: fonts.body, marginVertical: spacing.xs},
  group: {color: colors.accent, fontSize: fonts.small, fontWeight: '700', marginTop: spacing.m},
});
