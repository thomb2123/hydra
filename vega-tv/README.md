# Stremio and FlixNest on a Vega OS Fire TV Stick

Native, sideloadable apps for an **Amazon Fire TV Stick 4K running Vega OS 2.0**
(Software Version `OS 2.0 (2502000007420)`), built with Amazon's Vega SDK, plus a
proof-of-concept app that checks the platform behaviours the two apps depend on.

> **Status: built, not yet proven on the device.** All three packages build
> with the official SDK. Their logic is unit-tested, and the Stremio and
> FlixNest network flows were checked against the live services. **Nothing has
> been shown playing on the stick yet**, so treat the "works" columns as
> unverified until the tests in [Test plan](#test-plan) pass on your device.

| Package | What it is | Built | Verified on stick |
|---|---|---|---|
| `release/vegapoc_armv7.vpkg` | Proof of concept: remote, codecs, network, storage, test videos | ✅ | ⏳ |
| `release/stremiotv_armv7.vpkg` | Native Stremio client (your account, add-ons, library) | ✅ | ⏳ |
| `release/flixnesttv_armv7.vpkg` | Native FlixNest client (Flix-Streams account, Xtream, playlist) | ✅ | ⏳ |

`release/SHA256SUMS` holds the checksums.

---

## 1. What was found

### Vega OS facts (verified in Amazon's current docs, Vega 2.0, last modified 29 Oct–6 Nov 2026)

- Vega apps are **React Native for Vega** packages (`.vpkg`). Fire TV sticks use
  the **armv7** package. Android APKs cannot run: there is no Android runtime,
  framework or ABI on Vega. Renaming or repackaging an APK cannot change that.
- **Developer Mode** is enabled with the Vega CLI and an Amazon Developer
  account. The commands you quoted are current:
  `vega devmode login` then `vega devmode enable-device --code <6-digit code>`.
  The code on the TV **expires after 5 minutes**. Source:
  developer.amazon.com/docs/vega/2.0/developer-mode.html. The installed CLI
  (v1.4.9) confirms the syntax and adds an optional `--vendor` flag.
- Enabling Developer Mode is an **Amazon cloud call**. `login` uses a device
  sign-in flow (open a URL, enter a short code), so it works from any terminal.
  Only installing apps needs a connection to the stick.
- Apps can be installed **over Wi-Fi without a USB cable**. Set
  *Developer Options → Connection Mode → Use standard port 5555*, then run
  `vega exec vda connect <stick-ip>:5555`. Source: vda-over-tcpip.html.
- Install and launch use `vega device install-app --packagePath x.vpkg` and
  `vega device launch-app --appName <id>.main`. Developer Mode stays on until you
  turn it off or factory-reset the stick.
- **Supported build hosts are native Ubuntu x86_64 and macOS only.** "Windows is
  not a supported build host", and the install page says Windows and WSL "aren't
  supported or tested" (target-os-version.html, install-vega-sdk.html).
- Native player (W3C media API on GStreamer, hardware decoding). URL mode plays
  MP4, MKV, AVI, MOV, MPEG-TS, WebM and FLV:
  - video: H.264, HEVC (incl. 10-bit/HDR), AV1, VP9, MPEG-2;
  - audio: AAC, Dolby AC-3/E-AC-3/AC-4, Opus, FLAC, MP3 (DTS is HDMI passthrough only);
  - HLS and DASH need **MSE mode plus a JavaScript player**, i.e. Amazon's
    patched Shaka Player or hls.js (media-player.html, media-player-hello-world.html).
- The WebView is Chromium-based but supports fewer formats (no AC-3), so the
  apps here are native. They are not website wrappers.

### Existing apps

- **Stremio**: no Vega build exists. Stremio's downloads page (checked
  12 Nov 2026) offers Android, Android TV, desktop and web only, and its GitHub
  organisation has no Vega project. AFTVnews reports that the Fire TV Appstore
  listing excludes the Vega-based 4K Select (secondary source, not checked here).
- **FlixNest**: no Vega build. The service offers an Android/Fire OS APK and the
  web player at `player.flixnest.app/webplayer/` (plain JS with hls.js 1.7.2,
  Vidstack and its own TV-remote navigation).
- No credible third-party Vega port of either app was found.

### Approaches considered

| Approach | Verdict |
|---|---|
| Install an existing Vega package | None exists for either app. |
| Port the Android APK | Not possible: no Android runtime on Vega. The APK is only useful as an API reference. |
| Port app source | stremio-web (GPL-2.0) is a web app. Running it would mean a WebView wrapper, which you ruled out, and the WebView lacks AC-3. stremio-core (Rust, MIT) was used as the **reference for protocols**. |
| **Native Vega app talking to each service's own APIs** | **Chosen.** Native UI and D-pad focus, native playback, sideloaded `.vpkg`. |
| PC as backend | **Stremio only**, for torrents, YouTube and header-protected streams: your PC runs Stremio's official streaming server, and the stick plays from it. FlixNest needs no PC. |

### Does the PC have to stay on?

- **Stremio**:
  - **Yes** for torrent streams (including the Public Domain Movies add-on),
    YouTube, streams that need special headers, and subtitle re-encoding. The
    stick fetches them from your PC on port 11470.
  - **No** for direct HTTP(S) streams (e.g. debrid add-ons) and for browsing,
    sign-in and your library.
- **FlixNest**: **no**. The stick talks to FlixNest's servers directly.
- **Developer tools on the PC** are only needed to enable Developer Mode and to
  install or update the apps.

---

## 2. Set up your Windows PC (least disruptive option)

Your PC: Windows 11 Pro 25H2 (build 26200). Two options:

| Option | Amazon support | Disruption | Recommendation |
|---|---|---|---|
| **WSL2 + Ubuntu 24.04** | ❌ Not supported or tested by Amazon. **Not yet verified on a real PC by me either.** | Low: a Microsoft feature, uninstallable | **Try first.** The CLI is a standard Linux x86_64 binary, and the stick is reached over plain TCP. |
| Ubuntu 24.04 VM (Hyper-V, external/bridged switch) | Ubuntu is supported; running in a VM is not explicitly covered | Medium | Fallback if WSL fails |
| Native Ubuntu (dual boot or live USB) | ✅ Supported | High | Only if both fail |

These packages were **built** on native Ubuntu 24.04 x86_64 (an officially
supported host). Your PC only needs the CLI to enable Developer Mode and to
install the packages.

### 2.1 Install WSL2 + Ubuntu (PowerShell as administrator)

```powershell
wsl --install -d Ubuntu-24.04
```

Reboot if asked, open **Ubuntu 24.04** from the Start menu and create a Linux
user. Optional: copy `scripts/windows/wslconfig.example` to `%UserProfile%\.wslconfig`
(mirrored networking), then run `wsl --shutdown`.

### 2.2 Install the Vega CLI and SDK (inside the Ubuntu window)

```bash
git clone --depth 1 -b claude/stremio-flixnest-fire-tv-2k4hzj https://github.com/thomb2123/hydra.git
cd hydra/vega-tv
./scripts/wsl/setup-vega-cli.sh
source ~/vega/env
vega --version          # expect "Vega CLI Version: 1.4.x" and an SDK 2.0.x
```

`setup-vega-cli.sh` installs `curl jq lz4 build-essential` and runs Amazon's
official installer (`curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash`).
It also opts out of SDK telemetry. It downloads about 5 GB, and the SDK needs
about 8 GB of disk.

---

## 3. Enable Developer Mode (one time)

You need a free **Amazon Developer account** (developer.amazon.com) with your
developer profile completed; that creates the "vendor" the CLI asks for. A
third-party guide recommends using the same Amazon account as the stick. You do
the Amazon sign-in yourself in your browser. Nothing is entered in this repo or
in chat.

1. **In WSL:** `vega devmode login`. It prints a URL and a code. Open the URL
   in a Windows or phone browser, sign in, approve, and wait for
   `Login successful!`.
2. **On the TV:** Settings → My Fire TV → About → select the device name →
   press **OK seven times**. Back → **Developer options** → **Developer Mode**
   → **Continue**. A **6-digit code** appears and expires in **5 minutes**.
3. **In WSL, within 5 minutes:**
   ```bash
   vega devmode enable-device --code 123456      # your code
   ```
   If you have several vendors it asks you to pick one (or pass `--vendor <id>`).
   The stick **reboots**.
4. **On the TV:** Developer Options → Developer Mode shows **Enabled**.
5. **On the TV:** Developer Options → **Connection Mode** → **Use standard port
   5555** → Continue. The stick reboots again.
6. Note the stick's IP: Settings → My Fire TV → About → **Network**.

If the code expires, choose **Request a New Code** on the TV. If `login` fails
with "session expired", run `vega devmode logout`, then `vega devmode login`
again.

---

## 4. Install the apps

Get the packages one of two ways:

- From this repo's `vega-tv/release/` folder (your clone in step 2.2 already
  has them).
- From the files sent in chat, saved to Windows Downloads, which WSL sees as
  `/mnt/c/Users/<you>/Downloads/`.

```bash
cd ~/hydra/vega-tv
./scripts/wsl/install-apps.sh 192.168.1.50                       # stick IP; installs all three
# or individually:
./scripts/wsl/install-apps.sh 192.168.1.50 release/vegapoc_armv7.vpkg
```

The script checks the SHA-256 sums, connects with `vega exec vda connect`,
confirms the stick is listed and runs `vega device install-app` for each
package. Manual equivalent:

```bash
vega exec vda connect 192.168.1.50:5555
vega exec vda devices                       # must list 192.168.1.50:5555  device
vega device install-app --device 192.168.1.50:5555 --packagePath release/vegapoc_armv7.vpkg
vega device launch-app  --device 192.168.1.50:5555 --appName dev.vegatv.poc.main
```

| App | Package ID | Launch name |
|---|---|---|
| Vega TV Test (PoC) | `dev.vegatv.poc` | `dev.vegatv.poc.main` |
| Stremio (Vega) | `dev.vegatv.stremio` | `dev.vegatv.stremio.main` |
| FlixNest (Vega) | `dev.vegatv.flixnest` | `dev.vegatv.flixnest.main` |

The apps also appear under **Your Apps** on the home screen. To remove one:
`vega device uninstall-app --device <ip>:5555 --appName dev.vegatv.poc.main`.
Logs: `vega device start-log-stream --device <ip>:5555`. The PoC prefixes its
lines with `[vegapoc]`.

---

## 5. Stremio streaming server on the PC (Stremio only)

Install **one** of:

- **Stremio Service**: Stremio's official headless server (tray icon, GPL-2.0),
  `https://dl.strem.io/stremio-service/v0.1.21/StremioServiceSetup.exe`, or the
  latest from github.com/Stremio/stremio-service/releases.
- The normal **Stremio desktop app** (www.stremio.com/downloads). It runs the
  same server while it is open.

Then, in an **administrator** PowerShell:

```powershell
cd <repo>\vega-tv\scripts\windows
powershell -ExecutionPolicy Bypass -File .\allow-stremio-server.ps1
```

This opens TCP 11470 for **Private** networks only and prints the PC's LAN IP.
Check `http://127.0.0.1:11470/settings` in a PC browser: it should return JSON.
In the Stremio app on the TV, go to **Settings & sign-in → Streaming server**,
enter the PC's IP and choose **Test & save**.

---

## 6. Test plan

Report each result (photos of the TV are fine). Playback only counts if
picture **and** sound play and the remote works.

### 6.1 Proof of concept (`Vega TV Test`). Do this first.

1. **Remote test**:
   - Press arrows, OK, play/pause, rewind, fast-forward, menu and Back.
   - Expected: each press appears as `HW <key> action=0/1`, Back increments
     the counter, and Back twice returns.
   - Report the exact `action=` values.
2. **Test videos**, one at a time:

   | Video | Expected |
   |---|---|
   | MP4 · H.264 + AAC (Big Buck Bunny) | Must play with sound; ◀ ▶ seek 10 s; OK pauses; Back exits |
   | MKV · H.264 + AAC (Matroska test 2) | Must play |
   | MKV · 2 audio + 7 subtitles (test 5) | Plays; ▲ opens the menu; audio switch and embedded subtitles work |
   | MKV + external SRT | ▲ → pick *English (built into app)* → text appears in the first seconds; repeat with *external SRT demo* (downloads from GitHub) |
   | MPEG-TS segment | Plays about 10 s. This is the container Xtream live TV uses |
   | HLS manifest in URL mode | **Expected to fail**; confirms HLS needs Shaka |
   | MKV · Theora + Vorbis | Edge case; either result is useful |

3. **Codec probe**: photograph the list (`probably`/`maybe` = supported).
4. **Network & sign-in probe → Run all probes**: photograph the results. Two
   lines decide whether FlixNest account sign-in can work:
   - *Cookie jar: cookie sent back automatically?*
   - *set-cookie visible to JS*
5. **Storage**: exit and relaunch. The "Launch #" counter must increase. Reboot
   the stick and check again.

### 6.2 Stremio (report separately)

1. Without signing in, the home screen shows Cinemeta, YouTube and **Public
   Domain Movies** rows. Navigate rows and posters with the D-pad.
2. Settings & sign-in → **Sign in with a code**. Open the link or QR on your
   phone and approve. Your add-ons and library should load.
3. Streaming server: enter the PC IP → **Test & save** → "Connected …".
4. **Permitted test**: Public Domain Movies → *The Kid (1921)* → Choose stream
   → `1080p · 💾 859 MB` (torrent via your PC). It must play with sound, and
   ◀ ▶ seek. Note how long it takes to start.
5. Subtitles: ▲ during playback → choose an OpenSubtitles track (fetched through
   the PC server).
6. Back out mid-film, then reopen it. It should resume (local resume; library
   sync only updates titles already in your Stremio library).
7. Search (on-screen keyboard), series with seasons and episodes.
8. If you use direct-link add-ons (e.g. debrid), test one with the PC
   **switched off**; it should still play.

### 6.3 FlixNest (report separately)

1. **Phone sign-in**: scan the QR or enter the 8-letter code at
   `player.flixnest.app/webplayer/pair`, then approve. The TV should open Live TV.
2. Exit and relaunch. The app should stay signed in, which depends on cookies;
   see PoC probe 4.
3. **Movies**: play one. Seek, check audio and subtitle menus (▲/▼), Back,
   reopen, resume.
4. **Series**: season, then episode, then playback.
5. **Live TV**: pick a channel. If the stream is HLS (likely), it currently
   shows *"HLS/DASH streams need the Vega Shaka build"*; see the blockers
   below. If the channel plays, ▲ ▼ change channel.
6. **Events**: choose a broadcast.
7. If a movie the web player refuses ("AVI" or "plain HTTP") is available, test
   it; the native player may play it.

Please only test content you are entitled to watch. The apps add no content of
their own.

---

## 7. Known blockers and next experiments

| # | Blocker | Evidence | Next step |
|---|---|---|---|
| 1 | **HLS/DASH (most live TV) needs Amazon's patched Shaka Player.** Amazon distributes it as patches on Shaka 4.16.13, built from source (`git clone` + `python3 build/all.py`). That build was **refused by the build environment's safety policy** ("code from external"). | `media-player-hello-world.html`: "If you point it at an HLS (.m3u8) or DASH (.mpd) manifest, playback fails"; PoC video "HLS manifest in URL mode" | Approve that build step (or run it yourself on Ubuntu or WSL from `amzndevresources.com/vega/media-player/shaka-rel-v4.16.13-r1.2-devices_scope.tar.gz`). The player already has an adaptive-player slot (`shared/src/player/adaptive.ts`). |
| 2 | **FlixNest account sessions use HTTP cookies**; unknown whether Vega's `fetch` keeps them | Web player: `account/session` returns `account_required` without the cookie (checked live) | PoC network probe 4. If cookies are not kept, the app's manual cookie handling is the fallback; Xtream or playlist sign-in needs no cookies. |
| 3 | WSL2 is not Amazon-supported | Amazon docs | Try it; fall back to an Ubuntu VM. |
| 4 | DTS audio only works as HDMI passthrough | Amazon codec list | Needs a DTS-capable TV or soundbar; otherwise server transcoding, which outputs HLS and so also needs blocker 1. |
| 5 | Stremio `externalUrl` streams (open another app or website) | Vega cannot launch external browsers or apps from here | Not supported; the app shows a message. |
| 6 | Torrent playback depends on your PC's server reaching peers | Not testable in the build environment | Test 6.2.4. |

---

## 8. Build from source (Ubuntu 24.04 x86_64)

```bash
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env
vega sdk install 2.0.13986
cd vega-tv/apps/<vega-poc|stremio-vega|flixnest-vega>
npm install
npm test && npx tsc --noEmit
npm run build:release        # -> build/armv7-release/<name>_armv7.vpkg
python3 ../../tools/make_icons.py   # regenerate icons if needed
```

Layout:

```
vega-tv/
  shared/src/            player (W3C media), remote/back helpers, storage, net, subtitles, UI
  apps/vega-poc/         proof of concept
  apps/stremio-vega/     Stremio client (src/stremio/*: protocol, API, streaming server)
  apps/flixnest-vega/    FlixNest client (src/flixnest/api.ts: web-player API)
  scripts/wsl/           setup-vega-cli.sh, install-apps.sh
  scripts/windows/       allow-stremio-server.ps1, wslconfig.example
  release/               built .vpkg files + SHA256SUMS
```

The protocols follow stremio-core (MIT) and stremio-video. No Stremio or
FlixNest code is copied, and no official branding is used beyond names for
identification. These are unofficial clients.
