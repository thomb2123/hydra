// Remote-control helpers shared by the Vega apps.
//
// Vega delivers remote presses through useTVEventHandler as HWEvent objects.
// eventKeyAction is 0 for key-down and 1 for key-up on the devices documented
// so far, but the proof-of-concept app logs the raw values so this can be
// confirmed on the user's stick. To avoid acting twice per press, a key-up only
// fires the handler when no key-down was seen for that key.
import {useEffect, useRef} from 'react';
import {
  BackHandler,
  HWEvent,
  useKeplerBackHandler,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';

export type RemoteKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'back'
  | 'playpause'
  | 'play'
  | 'pause'
  | 'skip_forward'
  | 'skip_backward'
  | 'menu'
  | 'channel_up'
  | 'channel_down'
  | string;

const KEY_DOWN = 0;
const KEY_UP = 1;

export function normaliseKey(eventType: string): RemoteKey {
  switch (eventType) {
    case 'enter':
      return 'select';
    case 'media_play_pause':
      return 'playpause';
    case 'fast_forward':
    case 'media_fast_forward':
      return 'skip_forward';
    case 'rewind':
    case 'media_rewind':
      return 'skip_backward';
    case 'page_up':
      return 'channel_up';
    case 'page_down':
      return 'channel_down';
    default:
      return eventType;
  }
}

/**
 * Calls `handler` once per physical press. Returns nothing; register it at the
 * top of a screen component. Pass `enabled=false` to ignore keys while another
 * layer (for example a menu) owns the remote.
 */
export function useRemoteKeys(
  handler: (key: RemoteKey, event: HWEvent) => void,
  enabled: boolean = true,
): void {
  const handlerRef = useRef(handler);
  const enabledRef = useRef(enabled);
  const downSeen = useRef<Record<string, number>>({});
  handlerRef.current = handler;
  enabledRef.current = enabled;

  useTVEventHandler((event: HWEvent) => {
    if (!enabledRef.current || !event || !event.eventType) {
      return;
    }
    const key = normaliseKey(String(event.eventType));
    const action = event.eventKeyAction;
    if (action === KEY_DOWN) {
      downSeen.current[key] = Date.now();
      handlerRef.current(key, event);
      return;
    }
    if (action === KEY_UP) {
      const seenAt = downSeen.current[key];
      delete downSeen.current[key];
      if (seenAt && Date.now() - seenAt < 5000) {
        return;
      }
      handlerRef.current(key, event);
      return;
    }
    handlerRef.current(key, event);
  });
}

/**
 * Registers a Back handler. Return true from `onBack` to consume the press;
 * return false to let the system handle it (which exits the app at the root).
 */
export function useBackHandler(onBack: () => boolean, enabled: boolean = true): void {
  const keplerBack = safeKeplerBackHandler();
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const listener = () => onBackRef.current();
    if (keplerBack) {
      const subscription = keplerBack.addEventListener('hardwareBackPress', listener);
      return () => subscription.remove();
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', listener);
    return () => subscription.remove();
  }, [enabled, keplerBack]);
}

function safeKeplerBackHandler() {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useKeplerBackHandler();
  } catch {
    return null;
  }
}

export function exitApp(): void {
  BackHandler.exitApp();
}
