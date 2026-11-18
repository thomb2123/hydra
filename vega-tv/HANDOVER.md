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

- **MKV films play through the in-app engine** (resume and skipping need it: the platform player cannot seek inside MKV); MP4 and others play in the platform player, straight from the debrid
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

- **Official guides for every channel (`tv/officialGuide.ts`, `tv/skyGuide.ts`):** now/next
  is what a real guide says the channel should show, never the IPTV providers' own guide:
  - UK: Sky's listings (`awk.epgsky.com/hawk/linear/schedule/{YYYYMMDD}/{sid}`, ~0.1 s from
    the stick, cached 30 min, synopses, live shows titled "Live …"); Virgin Media's guide
    (6-hour segments, `isLive`) for TNT Sports Ultimate.
  - US: TV Guide's national grid (`backend.tvguide.com/tvschedules/tvguide/9100001138/web`,
    one ~200 KB request for ~150 channels, `airingAttrib` bit 1 = live); descriptions per
    programme from `programdetails/{id}/web`, also fetched for the focused channel if the
    list's own request did not finish. tvtv.us and Zap2it block UK connections.
  - No listing anywhere (`OFFICIAL_NONE`, with the reason shown): Sky Sports Action/Darts,
    Sky Cinema Hits/Animation/Select, Sky Replay, Eurosport 1/2 (closed), LaLiga TV,
    RedZone, ABC News Live, CBS News, NBC News Now. A test fails if a channel has neither.
  - Renamed: ITVBe is ITV Quiz, Sky Sports Arena is Sky Sports+, Sky Max/Showcase are Sky One.

  LIVE comes from the guide's own live flag; a match, race or fight on a sports channel that
  the guide does not list as live is tagged REPLAY. The providers' guides are still read: when
  they disagree, the details panel and the banner say what the stream is labelled as, and
  Sources (☰) marks each source's guide ✓/✗. **Live Now:** an event on a channel with an
  official guide is shown only when that guide lists the match now ("✓ The TV guide lists it
  on this channel now"); direct event feeds no guide covers are shown last, marked "Not
  confirmed by a TV guide" (a "beIN Sports 1" feed for Real Madrid v Inter was really ESPN).

- **Channel audit, 18 Nov ~19:35 (scratchpad `audit_guide.spec.ts`, `audit_frames.mjs`,
  `audit_sheets.mjs`):** the line-up was built exactly as the stick does, then one real frame
  was grabbed (ffmpeg on the PC) from the source the app ranks first on every channel, and
  labelled with the official listing. 119/142 gave a picture first time (1 × 4K, 72 × 1080p,
  39 × 720p, 7 SD); almost all matched their official listing. Found and fixed:
  - looping "UNDER MAINTENANCE" / "NO LIVE EVENT" clips served as live streams (their playlists
    look normal) on dream4k "ᵁᴴᴰ" Sky Comedy, Sky Atlantic, Sky Sports NFL, Premier Sports 2;
    generic US network entries carrying other channels (streamsports99 "ABC HD" = ABC News
    Live, "FOX HD" = Fox News, dream4k "NBC ᴴᴰ" = CNBC). `KNOWN_WRONG` in `channels.ts`
    ranks them last; the affiliate feeds ("ABC (EAST)", "NBC (WNBC)") are the real networks.
  - Sky Cinema Hits / Select streams carry Sky's pop-ups (xXx, Christmas): mapped to those
    Sky listings, Select renamed Sky Cinema Christmas. Sky Sports Action and Darts removed
    (not Sky channels any more; they carried other channels' programmes).
  - Provider labels one programme behind/ahead, or naming the series, no longer count as a
    mismatch (`agreesWithOfficial`).
  - After ~140 openings the providers refused further connections ("I/O error"), so Sky
    Cinema Premiere/Drama, TNT Sports 1/3, BBC Three, C+I, Sky Nature, E!, Food Network, FS2,
    MLB Network, Golf Channel, HBO Signature, Bloomberg, The CW, LaLiga TV were not verified.
- **Live Now from official listings:** a live match no guide has confirmed on its channel is
  looked up in every sports channel's official listing (title + description, both team
  names); the channel listing it live becomes the event's channel, confirmed (the "beIN"
  Real Madrid v Inter feed was really on CBS Sports Network per TV Guide).
- **New:** Favourites (☰ on a channel; "Favourites" category with ★), "Recently Watched"
  category, ◀ while watching live TV returns to the previous channel, switching source by
  hand demotes the source left behind, Netflix-style "Next Episode" card in the last 40 s
  of an episode (15 s countdown, OK plays now, Back hides it), short fades between screens.
- **Dark picture on the stick (even its home screen):** the stick outputs a normal SDR
  signal (4K 59.94 Hz, 8-bit, colour space Auto, HDR Adaptive; `graphicsutility -d`), and
  its screenshots are normally bright, so the dimming is on the TV side (LG picture mode /
  energy saving / black level for that HDMI input).

- **Debrid only (18 Nov):** torrent / magnet streams are never picked, hidden from Other versions, and `resolveStream` refuses them (`DEBRID_ONLY` in `stremio/streaming.ts`), so the PC never joins a torrent swarm. Checked on the stick: Avengers: Endgame resumed from Comet (Real-Debrid) with no torrent activity.
- **Home after a film:** the home screen is rebuilt only once visible again (it showed no rows until a key press when rebuilt hidden under the title page).

- **Stick only (18 Nov):** `STICK_ONLY` in `state.ts`: the PC streaming server is never looked for (no network scan) or used, a saved PC address is ignored, Settings says no PC is needed. Checked: Avengers: Endgame played in 4K HDR10+ with subtitles, log "server=not set" and no request to the PC; live TV unaffected. Away from home the stick only needs Wi-Fi.
- **Double zap fixed:** a key press that changes screen (▼ rebuilding the player) was counted again when the new screen saw the key release; key-down times are now shared app-wide (`shared/src/tv/remote.ts`). Checked: one ▼ = one channel.

- **Polish (18 Nov, late):** guide rows read only the official listing (one cached request); the streams' own labels are compared only for the channel rested on (0.6 s) and in the player's Sources, so scrolling makes ~4x fewer network calls (checked: 10 fast ▼ = 10 channels, listings already shown). Back from a title page returns focus to the card that opened it (`Browse` remembers row + title; checked on Continue Watching). Title pages show "Resume from 6:00" and a Start Over button (not yet tried on the TV).

- **Smoother / more accurate (18 Nov, night):**
  - Guide rows and the player's banner move on to the next programme by themselves when the one on now ends (`msUntilChange` in `tv/epg.ts`; a cached listing whose programme has ended is not served). Before, a row kept the finished programme until the guide was reopened.
  - Live Now refreshed (1,000 events + scores + guide checks) twice every time a channel or film was left (re-ranking restarted its timer, and the return from playback refreshed again); the stick log showed refreshes every 10–15 s while zapping. Now at most one every 45 s, never two at once, and re-ranking no longer restarts it. The 30 s clock tick keeps the same Live Now list and the same `tv` object when nothing changed, so screens are not redrawn by it.
  - Stutter detector (`src/perf.ts`): logs `[stremio] perf: blocked N ms on <screen>` for any JS block over 120 ms, plus a per-minute summary, so smoothness can be measured from the device log.
  - "initialize failed: undefined" in the log was a player torn down mid-start while zapping; no longer logged or shown.
  - Channel re-check from the PC: BBC Three (720p) and Sky Sports Darts (1080p) now verified. The other 16 (Sky Replay 502; dream4k, strong_vault and streamsports99 sources refuse the PC with I/O errors / connection resets) remain unverified from the PC; Sky Cinema Premiere and TNT Sports 1 have played on the stick through dream4k.
  - Subtitle failures in the 17:00–18:00 log were the community mirror (opensubtitles.stremio.homes, still unreachable on 18 Nov 22:00); every film since the official-server rewrite loaded English subtitles.

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
