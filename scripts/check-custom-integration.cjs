const fs = require("node:fs");
const assert = require("node:assert/strict");
const yaml = require("yaml");
const read = (p) => fs.readFileSync(p, "utf8");
assert.equal(
  yaml.parse(read("electron-builder.yml")).publish.owner,
  "thomb2123"
);
assert.match(read("src/main/index.ts"), /owner: "thomb2123"/);
assert.match(
  read("src/renderer/src/components/header/auto-update-sub-header.tsx"),
  /github.com\/thomb2123\/hydra\/releases/
);
assert.match(
  read("src/main/helpers/launch-game.ts"),
  /await launchWithAutomaticSteamShortcut\(/
);
assert.match(
  read("src/main/helpers/launch-game.ts"),
  /automaticSteamShortcut: true/
);
assert.match(
  read("src/main/services/umu.ts"),
  /await launchWithAutomaticSteamShortcut\(/
);
assert.match(read("src/main/services/umu.ts"), /GAMEID: "umu-480"/);
assert.match(read("src/main/services/umu.ts"), /SteamOverlay64=n/);
assert.match(read("config/custom.env"), /MAIN_VITE_LAUNCHER_SUBDOMAIN=\s*$/);
assert.match(read("config/custom.env"), /MAIN_VITE_API_URL=https:\/\//);
console.log("Custom update feed and launch integration checks passed");
