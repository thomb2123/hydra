// Runs with read-only GitHub access. A conflict deliberately fails the job.
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const semver = require("semver");
const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
const repository = "thomb2123/hydra";
async function api(route, allowMissing = false) {
  const response = await fetch(`https://api.github.com/repos/${route}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GitHub request failed: ${response.status}`);
  return response.json();
}
(async () => {
  if (process.env.GITHUB_REPOSITORY !== repository)
    throw new Error("Wrong release repository");
  const latest = await api("hydralauncher/hydra/releases/latest");
  if (
    !/^v\d+\.\d+\.\d+$/.test(latest.tag_name) ||
    latest.prerelease ||
    latest.draft
  )
    throw new Error("Unexpected upstream release");
  const current = JSON.parse(fs.readFileSync("package.json")).version;
  const next = latest.tag_name.slice(1);
  git("config", "user.name", "hydra-update-bot");
  git(
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com"
  );
  git("switch", "-c", "custom-candidate");
  if (semver.gt(next, current)) {
    git(
      "fetch",
      "--no-tags",
      "https://github.com/hydralauncher/hydra.git",
      `refs/tags/${latest.tag_name}`
    );
    git("merge", "--no-edit", "--no-ff", "FETCH_HEAD");
    if (JSON.parse(fs.readFileSync("package.json")).version !== next)
      throw new Error("Merged version mismatch");
  }
  const version = JSON.parse(fs.readFileSync("package.json")).version;
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid candidate version");
  const existing = await api(`${repository}/releases/tags/v${version}`, true);
  if (existing) {
    if (existing.draft)
      throw new Error("An unfinished draft release needs attention");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "build=false\n");
    return;
  }
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `build=true\nversion=${version}\n`
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
