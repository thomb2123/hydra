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

## Open issues (in priority order)

1. **About 5 minutes into a film, playback stalls.** The spinner shows, then
   the picture freezes until the viewer fast-forwards or rewinds, after which
   it's fine for another ~5 minutes.
   - Suspected cause: the MSE buffer fills. In `shared/src/mkv/session.ts`,
     `AHEAD_SECONDS=30` and `BEHIND_SECONDS=20`; `trimBehind()` only runs under
     back-pressure or after a quota error. About 450 MB of 4K is roughly
     5 minutes.
   - Planned fix:
     1. capture the stick's logs during a stall (the dev shell service must be
        running; reconnect `vda` first);
     2. make sure watched data is really removed, and use a smaller look-ahead;
     3. add a stall watchdog that re-seeks to the current position automatically.
   - Don't install while the owner is watching: installing restarts the app.
2. The FlixNest and test-app packages in `release/` are the old builds.
3. Paused by the owner:
   - the Vega Shaka build (HLS/DASH; patches apply, but `npm ci` hit a
     git-dependency cache error);
   - capability probes and 4K/HDR/Dolby tuning;
   - moving to a standalone repo `thomb2123/vega-tv`. The owner must create an
     empty repo; the local branch `vega-tv-standalone` holds the split history.
