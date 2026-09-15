const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const { EventEmitter } = require("events");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const ts = require(root + "/node_modules/typescript");
const editor = require(root + "/node_modules/steam-shortcut-editor");
const dir = fs.mkdtempSync(
  path.join(require("os").tmpdir(), "hydra-shortcut-test-")
);
let running = false,
  answer = 0,
  writes = 0,
  prompts = 0;
const calls = [];
const vdf = path.join(dir, "steam/userdata/1/config/shortcuts.vdf");
fs.mkdirSync(path.dirname(vdf), { recursive: true });
fs.writeFileSync(
  vdf,
  editor.writeBuffer({
    shortcuts: [{ appid: 123, AppName: "Existing", Exe: '"/existing"' }],
  })
);
const read = () => editor.parseBuffer(fs.readFileSync(vdf)).shortcuts;
const mocks = {
  "node:fs": {
    ...fs,
    existsSync: (p) => p === "/usr/games/steam" || fs.existsSync(p),
  },
  electron: {
    app: { getPath: () => path.join(dir, "hydra") },
    dialog: {
      showMessageBox: async () => {
        prompts++;
        return { response: answer };
      },
    },
  },
  "node:child_process": {
    spawnSync: () => ({ status: running ? 0 : 1 }),
    spawn: (command, args) => {
      calls.push(args);
      if (args[0] === "-shutdown") running = false;
      const emitter = new EventEmitter();
      emitter.unref = () => {};
      queueMicrotask(() => emitter.emit("spawn"));
      return emitter;
    },
  },
  "./logger": { logger: { info() {}, warn() {} } },
  "./steam": {
    getSteamLocation: async () => path.join(dir, "steam"),
    getSteamUsersIds: async () => [1],
    getSteamShortcuts: async () => read(),
    writeSteamShortcuts: async (id, shortcuts) => {
      assert.equal(running, false, "never write while Steam is running");
      writes++;
      fs.writeFileSync(vdf, editor.writeBuffer({ shortcuts }));
    },
    composeSteamShortcut: (title, exe, icon, options, launch) => ({
      appid: 3000000000 + writes,
      appname: title,
      Exe: `"${exe}"`,
      LaunchOptions: launch.launchOptions,
      AllowOverlay: true,
    }),
  },
};
const mod = { exports: {} };
const context = vm.createContext({
  module: mod,
  exports: mod.exports,
  require: (name) => mocks[name] || require(name),
  process,
  setTimeout,
  console,
});
const src = fs.readFileSync(
  root + "/src/main/services/automatic-steam-shortcut.ts",
  "utf8"
);
vm.runInContext(
  ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText,
  context
);
const {
  launchWithAutomaticSteamShortcut: launch,
  makeSteamLaunchScript: make,
} = mod.exports;
const spec = {
  executablePath: "/games/First/game.exe",
  command: "/bin/echo",
  args: ["hello"],
  env: {},
  cwd: dir,
};
(async () => {
  assert.equal(await launch(spec), true);
  assert.equal(writes, 1);
  assert.equal(read()[0].AppName, "Existing");
  assert.equal(read().length, 2);
  assert(
    fs.readdirSync(path.dirname(vdf)).some((x) => x.includes("hydra-backup"))
  );
  running = true;
  await launch(spec);
  assert.equal(writes, 1);
  assert.equal(prompts, 0);
  answer = 1;
  assert.equal(
    await launch({ ...spec, executablePath: "/games/Second.exe" }),
    false
  );
  assert.equal(writes, 1);
  assert.equal(running, true);
  answer = 0;
  await launch({ ...spec, executablePath: "/games/Second.exe" });
  assert.equal(writes, 2);
  assert(calls.some((x) => x[0] === "-shutdown"));
  assert.equal(read().length, 3);
  const evil = "a 'quoted' $(printf WRONG) `printf WRONG`; x";
  const script = make({
    ...spec,
    command: "/usr/bin/printf",
    args: ["%s", evil],
    env: { GAMEID: "umu-480", SteamGameId: "480" },
  });
  assert(!script.includes("SteamGameId="));
  assert(script.includes("GAMEID="));
  const output = spawnSync("/bin/sh", ["-c", script], { encoding: "utf8" });
  assert.equal(output.status, 0);
  assert.equal(output.stdout, evil);
  assert.throws(() => make({ ...spec, env: { "BAD;KEY": "x" } }));
  console.log(
    "PASS: first-launch creation, VDF backup/preservation, reuse, restart consent/cancel, offline-only writes, shell quoting, Steam identity preservation"
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
