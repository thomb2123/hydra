// Subset of the Stremio add-on protocol and API types used by this client.
// Field names follow stremio-core (MIT) so responses map 1:1.

export interface ResourceDescriptor {
  name: string;
  types?: string[];
  idPrefixes?: string[];
}

export interface ExtraDescriptor {
  name: string;
  isRequired?: boolean;
  options?: string[];
}

export interface CatalogDescriptor {
  type: string;
  id: string;
  name?: string;
  extra?: ExtraDescriptor[];
  extraRequired?: string[];
  extraSupported?: string[];
}

export interface Manifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  resources: (string | ResourceDescriptor)[];
  types: string[];
  idPrefixes?: string[];
  catalogs?: CatalogDescriptor[];
  behaviorHints?: {configurationRequired?: boolean; adult?: boolean; p2p?: boolean};
}

export interface AddonDescriptor {
  transportUrl: string;
  manifest: Manifest;
  flags?: {official?: boolean; protected?: boolean};
}

export interface MetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
}

export interface Video {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
  description?: string;
  streams?: Stream[];
}

export interface MetaDetail extends MetaPreview {
  genres?: string[];
  runtime?: string;
  year?: string;
  videos?: Video[];
  behaviorHints?: {defaultVideoId?: string};
}

export interface StreamBehaviorHints {
  notWebReady?: boolean;
  bingeGroup?: string;
  filename?: string;
  videoSize?: number;
  videoHash?: string;
  countryWhitelist?: string[];
  proxyHeaders?: {request?: Record<string, string>; response?: Record<string, string>};
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
  // OpenSubtitles v3 extras (optional, used to pick and time subtitles).
  fpsMilli?: number;
  movieReleaseName?: string;
  subtitleFileName?: string;
  /** Match type: 'h' = video hash, 'i' = IMDb id. */
  m?: string;
}

export interface Stream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  sources?: string[];
  subtitles?: Subtitle[];
  behaviorHints?: StreamBehaviorHints;
}

export interface LibraryItemState {
  lastWatched?: string | null;
  timeWatched?: number;
  timeOffset?: number; // milliseconds
  overallTimeWatched?: number;
  timesWatched?: number;
  flaggedWatched?: number;
  duration?: number; // milliseconds
  video_id?: string | null;
  watched?: string | null;
  noNotif?: boolean;
}

export interface LibraryItem {
  _id: string;
  name: string;
  type: string;
  poster?: string | null;
  posterShape?: string;
  removed: boolean;
  temp: boolean;
  _ctime?: string;
  _mtime: string;
  state: LibraryItemState;
  behaviorHints?: Record<string, unknown>;
}

export interface User {
  _id: string;
  email: string;
}
