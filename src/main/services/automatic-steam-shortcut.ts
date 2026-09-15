import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  composeSteamShortcut,
  getSteamLocation,
  getSteamShortcuts,
  getSteamUsersIds,
  writeSteamShortcuts,
} from "./steam";
import { logger } from "./logger";

export interface SteamLaunchSpec {
  executablePath: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export const quoteSteamShellArgument = (value: string) =>
  `'${value.replace(/'/g, `'"'"'`)}'`;

export const makeSteamLaunchScript = (spec: SteamLaunchSpec) => {
  // UMU captures Steam's shortcut identity before assigning the game's AppID.
  // Preserve that incoming identity for Steam's overlay and window tracking.
  const assignments = Object.entries(spec.env)
    .filter(
      ([key]) =>
        !spec.env.GAMEID || (key !== "SteamGameId" && key !== "SteamAppId")
    )
    .map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        throw new Error("Invalid launch environment key");
      return `${key}=${quoteSteamShellArgument(value)}`;
    });
  return `#!/bin/sh\nset -e\ncd -- ${quoteSteamShellArgument(spec.cwd)}\nexec env ${assignments.join(" ")} ${[spec.command, ...spec.args].map(quoteSteamShellArgument).join(" ")}\n`;
};

const steamExecutable = () =>
  ["/usr/games/steam", "/usr/bin/steam"].find((candidate) =>
    fs.existsSync(candidate)
  );

const steamRunning = () =>
  spawnSync("pgrep", ["-u", String(process.getuid?.()), "-x", "steam"])
    .status === 0;

const sendToSteam = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(steamExecutable()!, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

const activeSteamUser = async () => {
  const ids = await getSteamUsersIds();
  const location = await getSteamLocation();
  const loginFile = path.join(location, "config", "loginusers.vdf");
  if (fs.existsSync(loginFile)) {
    const text = await fs.promises.readFile(loginFile, "utf8");
    for (const entry of text.matchAll(/"(\d{17})"\s*\{([^{}]*)\}/g)) {
      if (/"MostRecent"\s*"1"/i.test(entry[2])) {
        const id = Number(BigInt(entry[1]) - BigInt("76561197960265728"));
        if (ids.includes(id)) return id;
      }
    }
  }
  return ids.length === 1 ? ids[0] : null;
};

let pending: Promise<unknown> = Promise.resolve();

// Serialize first-launch updates so concurrent Play clicks cannot overwrite VDF entries.
export const launchWithAutomaticSteamShortcut = (
  spec: SteamLaunchSpec
): Promise<boolean> => {
  const task = pending.then(() => launch(spec));
  pending = task.catch(() => {});
  return task;
};

const launch = async (spec: SteamLaunchSpec): Promise<boolean> => {
  if (process.platform !== "linux" || !steamExecutable()) return false;
  const userId = await activeSteamUser();
  if (userId === null) {
    logger.warn("Automatic Steam shortcut needs an identifiable Steam account");
    return false;
  }
  const directory = path.join(app.getPath("userData"), "steam-launchers");
  const key = createHash("sha256")
    .update(path.resolve(spec.executablePath))
    .digest("hex")
    .slice(0, 24);
  const script = path.join(directory, `${key}.sh`);
  const readMatch = async () =>
    (await getSteamShortcuts(userId)).find(
      (item) => item.Exe === '"/bin/sh"' && item.LaunchOptions === `"${script}"`
    );
  let shortcut = await readMatch();
  if (!shortcut && steamRunning()) {
    const result = await dialog.showMessageBox({
      type: "question",
      title: "Enable Steam overlay for this game",
      message: "Hydra can create this game's Steam shortcut automatically.",
      detail:
        "Steam needs to restart once to detect it. Close any running Steam games first. Future launches will start from Hydra without this step.",
      buttons: ["Restart Steam and play", "Play without overlay"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) return false;
    await sendToSteam(["-shutdown"]);
    const deadline = Date.now() + 30000;
    while (steamRunning() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 500));
    if (steamRunning()) {
      await dialog.showMessageBox({
        type: "info",
        message: "Steam has not closed yet.",
        detail:
          "Hydra will play without the overlay this time. Exit Steam fully and press Play again to create the shortcut.",
      });
      return false;
    }
    shortcut = await readMatch();
  }
  await fs.promises.mkdir(directory, { recursive: true });
  const temporaryScript = `${script}.tmp`;
  await fs.promises.writeFile(temporaryScript, makeSteamLaunchScript(spec), {
    mode: 0o700,
  });
  await fs.promises.rename(temporaryScript, script);
  if (!shortcut) {
    // Steam must be closed: otherwise it can overwrite shortcuts.vdf from memory.
    if (steamRunning()) return false;
    const shortcuts = await getSteamShortcuts(userId);
    shortcut = composeSteamShortcut(
      path.basename(spec.executablePath, path.extname(spec.executablePath)),
      "/bin/sh",
      null,
      undefined,
      { appIdSeed: script, launchOptions: `"${script}"` }
    );
    const config = path.join(
      await getSteamLocation(),
      "userdata",
      String(userId),
      "config"
    );
    await fs.promises.mkdir(config, { recursive: true });
    const file = path.join(config, "shortcuts.vdf");
    if (fs.existsSync(file))
      await fs.promises.copyFile(file, `${file}.hydra-backup-${Date.now()}`);
    shortcuts.push(shortcut);
    await writeSteamShortcuts(userId, shortcuts);
    logger.info("Created automatic Steam overlay shortcut", {
      executablePath: spec.executablePath,
      appId: shortcut.appid,
    });
  }
  const id = (
    (BigInt(shortcut.appid >>> 0) << BigInt(32)) |
    BigInt(0x02000000)
  ).toString();
  await sendToSteam([`steam://rungameid/${id}`]);
  return true;
};
