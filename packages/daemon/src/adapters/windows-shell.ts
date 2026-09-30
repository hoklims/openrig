// OpenRig hands seats POSIX shell scripts (`/bin/sh file`, `env PATH=... codex`). On Windows the
// panes therefore run Git Bash, and any PATH written into a script has to use the POSIX form
// that Git Bash understands: MSYS converts an inherited PATH on its own, but not one that is
// spelled out on an `env PATH=...` command line.

import { existsSync } from "node:fs";

/** "C:\Program Files\Git\bin" -> "/c/Program Files/Git/bin"; "\\srv\share" -> "//srv/share". */
export function toPosixPath(entry: string): string {
  const unquoted = entry.replace(/^"(.*)"$/, "$1");
  const drive = /^([A-Za-z]):(?:[\\/](.*))?$/.exec(unquoted);
  if (drive) return `/${drive[1]!.toLowerCase()}/${(drive[2] ?? "").replace(/\\/g, "/")}`;
  return unquoted.replace(/\\/g, "/");
}

/** "C:\a;D:\b" -> "/c/a:/d/b". Empty entries are dropped. */
export function toPosixPathList(list: string): string {
  return list.split(";").filter((entry) => entry.length > 0).map(toPosixPath).join(":");
}

/** The PATH value to put on an `env PATH=...` line that a seat's POSIX shell will run. */
export function shellPathForLaunch(launchPath: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? toPosixPathList(launchPath) : launchPath;
}

/**
 * The POSIX shell a Windows pane should run: Git for Windows' bash. `System32\bash.exe`
 * is the WSL launcher and is never a candidate. An explicit override wins.
 */
export function resolveWindowsPaneShell(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") return undefined;
  const candidates = [
    env["OPENRIG_WINDOWS_SHELL"],
    env["CLAUDE_CODE_GIT_BASH_PATH"],
    env["ProgramFiles"] && `${env["ProgramFiles"]}\\Git\\bin\\bash.exe`,
    env["ProgramW6432"] && `${env["ProgramW6432"]}\\Git\\bin\\bash.exe`,
    env["ProgramFiles(x86)"] && `${env["ProgramFiles(x86)"]}\\Git\\bin\\bash.exe`,
    env["LOCALAPPDATA"] && `${env["LOCALAPPDATA"]}\\Programs\\Git\\bin\\bash.exe`,
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate) && exists(candidate!));
}
