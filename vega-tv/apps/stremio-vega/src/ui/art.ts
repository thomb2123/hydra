// Artwork URLs. Stremio's image service (images.metahub.space) serves
// backdrops and title logos for IMDb ids; add-on supplied art is preferred.
import {MetaPreview} from '../stremio/types';

function imdbId(meta: {id: string}): string | null {
  const match = /^(tt\d+)/.exec(meta.id || '');
  return match ? match[1] : null;
}

export function backdropOf(meta: MetaPreview, size: 'small' | 'medium' | 'large' = 'medium'): string | undefined {
  if (meta.background) {
    return meta.background;
  }
  const id = imdbId(meta);
  return id ? `https://images.metahub.space/background/${size}/${id}/img` : meta.poster;
}

export function logoOf(meta: MetaPreview): string | undefined {
  if (meta.logo) {
    return meta.logo;
  }
  const id = imdbId(meta);
  return id ? `https://images.metahub.space/logo/medium/${id}/img` : undefined;
}

export function yearOf(meta: MetaPreview): string {
  return String(meta.releaseInfo || '').replace(/[–-]\s*$/, '').trim();
}

/** The IMDb rating when there is one ("N/A" and empty values are not shown). */
export function ratingOf(meta: MetaPreview): string {
  const r = Number(String(meta.imdbRating || '').trim());
  return r > 0 && r <= 10 ? r.toFixed(1) : '';
}
