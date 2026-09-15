const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const yaml = require("yaml");
const asar = require("@electron/asar");
const version = JSON.parse(fs.readFileSync("package.json")).version;
const metadata = yaml.parse(fs.readFileSync("dist/latest-linux.yml", "utf8"));
assert.equal(metadata.version, version);
assert(metadata.files.some((f) => f.url.endsWith(".deb")));
assert(metadata.files.some((f) => f.url.endsWith(".AppImage")));
for (const file of metadata.files) {
  assert.equal(path.basename(file.url), file.url);
  const bytes = fs.readFileSync(path.join("dist", file.url));
  assert.equal(
    crypto.createHash("sha512").update(bytes).digest("base64"),
    file.sha512
  );
}
const root = "dist/linux-unpacked/resources";
const feed = yaml.parse(fs.readFileSync(`${root}/app-update.yml`, "utf8"));
assert.equal(feed.owner, "thomb2123");
assert.equal(feed.repo, "hydra");
const main = asar
  .extractFile(`${root}/app.asar`, "out/main/index.js")
  .toString();
assert(main.includes("thomb2123"));
assert(main.includes("umu-480"));
assert(main.includes("steam-launchers"));
assert(main.includes("hydra-api-us-east-1.losbroxas.org"));
for (const name of [
  "umu-run",
  "hydra-native/hydra-native.node",
  "hydra-python-rpc/hydra-python-rpc",
]) {
  assert(fs.statSync(path.join(root, name)).size > 0);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-package-smoke-"));
// Isolated test profile; sandbox switch applies only to this smoke process.
const useDesktop = process.argv.includes("--use-desktop-display");
const result = spawnSync(
  useDesktop ? path.resolve("dist/linux-unpacked/hydralauncher") : "xvfb-run",
  [
    ...(useDesktop
      ? []
      : ["-a", path.resolve("dist/linux-unpacked/hydralauncher")]),
    "--no-sandbox",
    "--disable-gpu",
    "--hidden",
    `--user-data-dir=${profile}`,
  ],
  { encoding: "utf8", timeout: 15000, killSignal: "SIGTERM" }
);
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
assert(
  !/Uncaught Exception|A JavaScript error occurred|Cannot find module|SyntaxError/.test(
    output
  ),
  output
);
assert(
  result.error?.code === "ETIMEDOUT",
  `App exited before smoke test completed: ${output}`
);
console.log(
  "Package files, checksums, update feed, and isolated startup smoke passed"
);
