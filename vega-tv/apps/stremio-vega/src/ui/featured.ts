// Tiny store for the focused ("featured") title, so moving focus re-renders only
// the billboard instead of the whole browse screen and every row.
import {useEffect, useState} from 'react';
import {MetaPreview} from '../stremio/types';

export interface FeaturedStore {
  get: () => MetaPreview | null;
  set: (meta: MetaPreview | null) => void;
  subscribe: (listener: (meta: MetaPreview | null) => void) => () => void;
}

export function createFeaturedStore(): FeaturedStore {
  let current: MetaPreview | null = null;
  const listeners = new Set<(meta: MetaPreview | null) => void>();
  return {
    get: () => current,
    set: (meta) => {
      // The same title again is ignored, unless it now comes with its details (a Continue
      // Watching card first shows only its name, then its full details arrive).
      if (meta === current || (meta && current && meta.id === current.id && !(meta.description && !current.description))) {
        return;
      }
      current = meta;
      listeners.forEach((listener) => listener(meta));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useFeatured(store: FeaturedStore): MetaPreview | null {
  const [meta, setMeta] = useState<MetaPreview | null>(store.get());
  useEffect(() => store.subscribe(setMeta), [store]);
  return meta;
}
