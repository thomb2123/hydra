# Handover: where the Vega Fire TV project stands

Last updated 17 Nov 2026. Read this first in any new session.

## The goal (owner's words, summarised)

A **stick-only** app that feels like a real streaming service, "Netflix with a
Stremio twist":
- **Stremio as the back end**: sign-in, add-ons, streams.
- **A Netflix-style front end**: a big purple "S" intro, then a home screen
  with trending (UK/US), new releases, categories and recommendations based on
  what has been watched.
- No add-on names or random text shown.
- **Automatic stream choice**, with no manual picking: the best 4K, HDR10/HDR10+
  and Dolby Atmos version for an **LG C6** TV.
- Instant starts, automatic English audio and the best subtitles (selected
  separately from audio), Netflix-style subtitles and player HUD.
- Working fast-forward, rewind and resume.
- Continue Watching and My List synced to the Stremio account.
- Remove from Continue Watching.
- Smooth transitions.

## Hardware and setup (done 12 Nov on the owner's PC)

- **Stick:** Fire TV Stick 4K, Vega OS 2.0, at `192.168.1.252:5555`. Developer
  Mode is on (vendor "Tb-tv"), registered on the owner's normal Amazon account.
  - Spec sheet: HDR10, HDR10+ and HLG; **no Dolby Vision**.
  - Passthrough of DD, DD+/Atmos and DTS; **no TrueHD**.
  - HEVC up to 35 Mbps; 1 GB RAM.
- **TV:** LG C6 48". It has Dolby Vision, HDR10, HLG and Atmos, but **no
  HDR10+ and no DTS**.
- **PC:** Windows 11, `192.168.1.242`.
  - WSL Ubuntu-24.04 lives on **F:\WSL** (C: was full). Linux user `thomb`,
    no password. Vega CLI 1.4.9 and SDK 2.0.13986 in `~/vega`, repo in `~/hydra`.
  - `vega devmode` needs a D-Bus session with gnome-keyring unlocked.
  - Stremio desktop provides the streaming server on `:11470`, used for torrents
    and the pre-play probe only.
- **ISP:** EE, which blocks some add-on hosts (e.g. `opensubtitles.stremio.homes`, `nip.io`).
- **Add-ons:** Real-Debrid via AIOStreams and Comet, plus AIOMetadata, Trakt and Cinemeta.
- **On-device testing via `vega exec vda shell`:**
  - `inputd-cli button_press KEY_*` presses remote keys;
  - `gwsi-tool-screenshooter /tmp/x.png` takes screenshots.
  - After install and launch the Fire TV home comes to the front, so take a
    screenshot first.

## What was built (commit `044cb5b`, branch `claude/stremio-flixnest-fire-tv-2k4hzj`)

The Stremio app (`apps/stremio-vega`) was redesigned and tested on the stick:
- Splash, home with featured title, Top 10 and rows, Categories, Search (own
  keyboard, live results), and title pages with Play/Resume, My List, Other
  versions and Remove from Continue Watching.
- Automatic version picker (`stremio/streamPicker.ts`, `autoPick.ts`):
  - prefers 4K HDR10/HDR10+, Atmos and English audio;
  - skips DV-only, TrueHD, hosts that can't seek and placeholder videos.
- **In-app MKV engine** (`shared/src/mkv/`). Vega's URL-mode player can't seek
  in MKV over HTTP and rejects Stremio `/proxy/` URLs, so the engine:
  - fetches the file in ranges (4 MB chunks);
  - remuxes it to fragmented MP4;
  - feeds it to MSE via `player.srcObject = mediaSource`.

  It keeps HEVC HDR10 and E-AC-3 Atmos, and picks the English audio track.
  Seeking and resume were verified on the stick. MP4 files and unsupported
  codecs fall back to URL mode, where seeking isn't possible.
- Subtitles: in-file subtitles first, then OpenSubtitles ranked by release name,
  with frame-rate correction (`subtitlePick.ts`, `shared/src/subtitles.ts`).
- Debrid streams play with the PC off. Torrents need the PC.

## Live TV in the Stremio app (built 17 Nov, not yet tested on the stick)

The owner asked for FlixNest's TV inside the Stremio app:
- only real UK and US channels, in correct categories and order;
- no duplicates, the best quality, clean names and a real now/next guide;
- live sport (football, Champions League, boxing, UFC, F1).

How it's built:
- **Back end:** the FlixNest web-player API (`src/tv/flixnest.ts`), signed in by
  phone pairing on the TV. Account access works without a cookie. Channel ids
  carry their provider (`dream4k:channel:123`), so any source plays without
  switching provider.
- **Providers on the account:** Trex, Strong8K, Dream 4K, DINO IPTV and
  Neo 4K Pro, about 190k entries in total.
- **Curated line-up:** `src/tv/lineup.ts` lists 142 channels in 11 categories
  (UK Entertainment, Drama & Crime, Sport, Films, News, Documentaries; US
  Networks, Entertainment & Drama, Sport, Films, News).
- **Matching:** `src/tv/normalize.ts` and `letters.ts` turn provider names
  (prefixes, superscript tags like ᵁᴴᴰ/ᴿᴬᵂ) into keys and a quality score.
  `channels.ts` merges up to 8 sources per channel; reliability learned on the
  stick demotes sources that fail. Against the real lists (17 Nov) all **142/142**
  channels matched, each from 2–5 providers.
- **Building the guide on the stick (`guide.ts`):** only useful UK/US categories
  are downloaded, about 11k entries in ~110 pages of 100 (FlixNest's page limit).
  It's cached and rebuilt in the background daily.
- **Now/next (`epg.ts`):** up to 3 sources are asked, and the majority title wins,
  because providers attach wrong guides (e.g. Sky Sports News on "Main Event").
- **Live Sport (`events.ts`):** FlixNest events kept only when they are English
  fixtures on a UK/US sports channel or UK/US PPV feed. Placeholders ("Next
  Event…"), replays and mis-tagged shows are dropped.
- **UI:** a "Live TV" tab (`screens/TvGuide.tsx`) with categories on the left and
  channels (logo, now with progress, next) on the right. `screens/TvPlayer.tsx`
  plays with a 10 s start timeout, falls back to the next source, and zaps with ▲/▼.
- **HLS needs Shaka:** live streams are HLS with MPEG-TS segments over plain HTTP
  from provider IPs. Build the player with `scripts/build-shaka.sh`; its output
  goes to `shared/src/player/shaka/vendor/` (git-ignored: Amazon Program Materials).
  It's registered in `apps/stremio-vega/index.js`.

Untested on the device: Shaka playback of these streams, guide build time on the
stick, and real picture quality per provider (the TS segments are on raw IPs this
cloud workspace can't reach).

## Verified on the stick, 18 Nov evening (supersedes the playback notes below)

- **Films play in the platform's own player** (URL mode), straight from the debrid
  server (the add-on redirect is followed once). This is the only path that plays 4K
  smoothly here: the in-app MKV engine reads through JavaScript XHR and its remux gave
  micro-stutter and audio stutter on 4K even on 5 GHz. The engine (restored to the
  044cb5bfc version, plus: append never stops the read loop, read-ahead, direct debrid
  URL, and B-frame decode times moved earlier by the reorder delay) is now only used when
  the platform player refuses to jump inside an MKV (resume/skip) - see `verifySeek`.
  The platform player cannot seek inside MKV over HTTP (tested: playing, paused, at open).
- **Frame-rate matching:** before a film starts, `player/frameRate.ts` reads the frame
  rate from the file header (MKV DefaultDuration or MP4 mdhd/stts) and calls
  `W3CMediaTurboModule.setRefreshRate`; the file is opened 1.5 s later (opening during
  the HDMI switch silences the player's events). `resetDisplayMode` on exit. Without
  this, 23.976 fps films judder at 60 Hz ("slideshow", no spinner).
- **Platform events can go missing:** a 1 s clock poll stands in for `timeupdate` and
  `playing` (start detection, position, progress saving).
- **Wi-Fi:** on 2.4 GHz the stick downloads ~30 Mbit/s and 4K stalls; on 5 GHz it measured
  145 Mbit/s plain / 66 Mbit/s TLS. Measure with `scratchpad stick_speed2.sh` style curl
  runs on the stick (`vda shell curl ...`).
- **Stream choice:** Real-Debrid links first; IPTV-panel film links (`/movie/123.mkv`,
  one connection, no seek) -300; no MP4 bonus (a fragmented MP4 stalled every ~30 s in the
  platform player); "not cached" placeholders (`slate.elfhosted.com`) are detected after
  the redirect and skipped; one start timeout no longer blacklists a host or add-on;
  bad-host list keys bumped to v3 (old entries were wrong).
- **Subtitles:** the community mirror `opensubtitles.stremio.homes` is blocked by BT/EE;
  its links are tried on `subs5.strem.io` first, the automatic choice skips failed
  servers, and the PC server is only used when it answers.
- **Live TV:** live HLS plays in the platform player (Shaka timed out every channel).
  Live Now: ESPN scoreboards (soccer, NBA, NFL, UFC, F1, tennis) + header feeds (cricket,
  rugby) decide what is really in progress; Stumps/delays count as not live; sports with
  no scores need the channel guide to say "Live"; events join 15 min before kick-off; no
  background stream probes (they used IPTV connection slots and caused 509s); background
  work pauses during playback and refreshes on return.
- **Guide navigation:** `TVFocusGuideView` (left returns to the current category, right to
  the last channel), category switch debounced, no focus grabbing after the first view.

## Open issues (in priority order)

1. **About 5 minutes into a film, playback stalled** (engine only; films now play in the
   platform player, see above) (spinner, frozen picture
   until the viewer skipped). Fixed in code on 18 Nov; **not yet confirmed on the stick.**
   - Cause found in `shared/src/mkv/session.ts`: any failed buffer write (quota
     full, an `error` instead of `updateend`, a timeout) ended the read loop for
     good, so playback ran out of buffer and froze until a seek restarted it.
     Retries also re-converted the same frames, shifting their timestamps.
   - Fix: the read loop recovers instead of stopping; pieces are converted once
     and the same bytes retried; look-ahead is capped by bytes (64 MB, shrinking
     to what the stick accepts after a quota error) as well as seconds; watched
     data is trimmed at keyframe boundaries; a watchdog steps over small gaps,
     restarts reading if it stopped, and reloads at the current position after
     8 s frozen. If the player will not free watched video (buffer full and
     under 4 s left), it downloads the next part while still playing, then clears and refills at the same spot (a
     short pause instead of a freeze). Films played by the platform (MP4/HLS)
     get a re-seek watchdog.
   - `scripts/dev/mkv-stall-sim.js` reproduces the stall with the old engine
     (write error, tight quota, lost piece) and shows the new one playing through.
   - On the stick, check the logs for `mkv: buffer limit reached`, `recovering`
     and `stalled` lines during a long film.
2. The FlixNest and test-app packages in `release/` are the old builds.
3. Paused by the owner:
   - the Vega Shaka build (HLS/DASH; patches apply, but `npm ci` hit a
     git-dependency cache error);
   - capability probes and 4K/HDR/Dolby tuning;
   - moving to a standalone repo `thomb2123/vega-tv`. The owner must create an
     empty repo; the local branch `vega-tv-standalone` holds the split history.
