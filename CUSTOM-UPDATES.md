# Custom Ubuntu releases

This public fork maintains the automatic native-Steam shortcut integration and
Linux launch compatibility. It does not contain games, accounts, save files,
OnlineFix DLLs, or credentials. Overlay availability still depends on each game.

The `Custom Ubuntu updates` workflow checks official stable releases daily. It
merges upstream into a temporary candidate, then runs integration checks, shortcut
regression tests, upstream tests, type checks, Ubuntu packaging, checksum checks,
and a startup smoke test. Only successful candidates become public releases.
Build jobs have read-only repository access; only the final publishing job can
update this fork and release its already-built artifacts.

The installed custom build checks **thomb2123/hydra**, never the upstream update
feed. Install this fork's first .deb manually with Hydra fully exited. Subsequent
versions use Hydra's update UI. If Linux auto-install was explicitly disabled,
enable it in Hydra's settings; Ubuntu may request administrator authentication.

A conflict or failed test deliberately stops publication. Your installed build
is not changed. Check the Actions failure notification, repair the candidate,
and rerun the workflow. This is automatic integration, not automatic AI repair:
structural changes and game-specific regressions can still need maintenance.
Tests cannot verify every game's overlay or online services.

Published releases are immutable in this workflow. A draft left by a failed
upload needs manual review before retrying. A race with another main-branch
change stops publication rather than overwriting it. GitHub can disable scheduled
workflows in inactive public forks; check Actions if updates stop appearing.

Keep launch changes concentrated in `automatic-steam-shortcut.ts`; its tests
cover shortcut reuse, backup, restart consent, offline-only VDF writes and shell
quoting. `patch-umu-steam-path.py` is idempotent and fails on unfamiliar UMU source.
Version 4.1.3 also aligns the OnlineFix launch prefix with cloud-save preparation
and avoids existing direct Steam shortcuts when automatic cloud sync is enabled.

For manual validation: `node scripts/check-custom-integration.cjs`,
`node scripts/test-custom-shortcuts.cjs`, `yarn test`, and `yarn build`.
Release configuration uses public endpoints in `config/custom.env`, with the
local renderer enabled so remote UI updates cannot replace custom UI code.
