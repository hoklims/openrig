import { mockShellCommand } from "./helpers/shell-command-mock.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexRuntimeAdapter, type CodexAdapterFsOps } from "../src/adapters/codex-runtime-adapter.js";
import { TmuxAdapter, type ArgvExecFn } from "../src/adapters/tmux.js";
import {
  resolveWindowsPaneShell,
  shellPathForLaunch,
  toPosixPath,
  toPosixPathList,
} from "../src/adapters/windows-shell.js";
import type { NodeBinding } from "../src/domain/runtime-adapter.js";

describe("toPosixPath / toPosixPathList", () => {
  it("turns drive paths into Git Bash form", () => {
    expect(toPosixPath("C:\\Program Files\\Git\\bin")).toBe("/c/Program Files/Git/bin");
    expect(toPosixPath("d:\\tools")).toBe("/d/tools");
    expect(toPosixPath("C:\\")).toBe("/c/");
    expect(toPosixPath("C:")).toBe("/c/");
  });

  it("keeps UNC and relative entries usable", () => {
    expect(toPosixPath("\\\\srv\\share\\bin")).toBe("//srv/share/bin");
    expect(toPosixPath(".\\bin")).toBe("./bin");
    expect(toPosixPath("/already/posix")).toBe("/already/posix");
  });

  it("strips the quotes Windows allows around a PATH entry", () => {
    expect(toPosixPath('"C:\\Program Files\\Git\\bin"')).toBe("/c/Program Files/Git/bin");
  });

  it("converts a whole PATH list and drops empty entries", () => {
    expect(toPosixPathList("C:\\Users\\me\\bin;;D:\\tools;C:\\Windows\\System32;"))
      .toBe("/c/Users/me/bin:/d/tools:/c/Windows/System32");
  });

  it("puts Git Bash's own tools first on the launch PATH, so sed/dirname/uname resolve", () => {
    expect(shellPathForLaunch("C:\\a;C:\\b", "win32")).toBe("/mingw64/bin:/usr/bin:/c/a:/c/b");
    expect(shellPathForLaunch("", "win32")).toBe("/mingw64/bin:/usr/bin");
  });

  it("only rewrites the launch PATH on win32", () => {
    expect(shellPathForLaunch("/usr/bin:/bin", "linux")).toBe("/usr/bin:/bin");
    expect(shellPathForLaunch("/usr/bin:/bin", "darwin")).toBe("/usr/bin:/bin");
  });
});

describe("resolveWindowsPaneShell", () => {
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";

  it("returns nothing off Windows", () => {
    expect(resolveWindowsPaneShell({ ProgramFiles: "C:\\Program Files" }, () => true, "linux")).toBeUndefined();
  });

  it("finds Git for Windows bash under Program Files", () => {
    const shell = resolveWindowsPaneShell({ ProgramFiles: "C:\\Program Files" }, (p) => p === gitBash, "win32");
    expect(shell).toBe(gitBash);
  });

  it("prefers an explicit override that exists", () => {
    const override = "D:\\tools\\bash.exe";
    const env = { OPENRIG_WINDOWS_SHELL: override, ProgramFiles: "C:\\Program Files" };
    expect(resolveWindowsPaneShell(env, () => true, "win32")).toBe(override);
  });

  it("skips an override that does not exist", () => {
    const env = { OPENRIG_WINDOWS_SHELL: "D:\\missing\\bash.exe", ProgramFiles: "C:\\Program Files" };
    expect(resolveWindowsPaneShell(env, (p) => p === gitBash, "win32")).toBe(gitBash);
  });

  it("never picks the WSL launcher in System32", () => {
    const env = { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" };
    const seen: string[] = [];
    resolveWindowsPaneShell(env, (p) => { seen.push(p); return false; }, "win32");
    expect(seen.some((p) => /system32/i.test(p))).toBe(false);
    expect(resolveWindowsPaneShell(env, () => false, "win32")).toBeUndefined();
  });
});

describe("TmuxAdapter.createSession pane shell", () => {
  const legacy = vi.fn(async () => "");
  const capture = () => {
    const argvs: string[][] = [];
    const argvExec: ArgvExecFn = async (argv) => { argvs.push(argv); return ""; };
    return { argvs, argvExec };
  };

  it("ends the new-session argv with the pane shell on the argv path", async () => {
    const { argvs, argvExec } = capture();
    const tmux = new TmuxAdapter(legacy, undefined, argvExec, "C:\\Program Files\\Git\\bin\\bash.exe");

    await tmux.createSession("dev-owner@rig", "E:\\work", { A: "1" });

    expect(argvs).toEqual([[
      "tmux", "new-session", "-d", "-s", "dev-owner@rig", "-c", "E:\\work", "-e", "A=1",
      "C:\\Program Files\\Git\\bin\\bash.exe",
    ]]);
  });

  it("adds nothing without a pane shell", async () => {
    const { argvs, argvExec } = capture();
    const tmux = new TmuxAdapter(legacy, undefined, argvExec);

    await tmux.createSession("s", "/work");

    expect(argvs).toEqual([["tmux", "new-session", "-d", "-s", "s", "-c", "/work"]]);
  });

  it("keeps the legacy shell-string path untouched", async () => {
    const commands: string[] = [];
    const tmux = new TmuxAdapter(async (cmd) => { commands.push(cmd); return ""; }, undefined, undefined, "C:\\bash.exe");

    await tmux.createSession("s", "/work");

    expect(commands).toEqual(["tmux new-session -d -s 's' -c '/work'"]);
  });
});

describe("Codex launch line on a Windows host", () => {
  const realPlatform = process.platform;
  afterEach(() => { Object.defineProperty(process, "platform", { value: realPlatform }); });

  const mockFs = (): CodexAdapterFsOps => ({
    readFile: () => { throw new Error("not found"); },
    writeFile: () => {},
    exists: () => false,
    mkdirp: () => {},
    listFiles: () => [],
  });
  const binding = (): NodeBinding => ({
    id: "b1", nodeId: "n1", tmuxSession: "r01-qa", tmuxWindow: null, tmuxPane: null,
    cmuxWorkspace: null, cmuxSurface: null, updatedAt: "", cwd: "/project", model: "gpt-5.5",
  });

  async function launchCommands(launchPath: string): Promise<string[]> {
    const tmux = mockShellCommand({
      sendText: vi.fn(async () => ({ ok: true as const })),
      hasSession: vi.fn(async () => true),
      getPaneCommand: vi.fn(async () => "codex"),
      capturePaneContent: vi.fn(async () => "OpenAI Codex (v0.0.0)\n› Ask Codex to do anything"),
      sendKeys: vi.fn(async () => ({ ok: true as const })),
      getPanePid: vi.fn(async () => null),
      listSessions: vi.fn(async () => []),
      listWindows: vi.fn(async () => []),
      listPanes: vi.fn(async () => []),
    } as unknown as TmuxAdapter);
    const adapter = new CodexRuntimeAdapter({
      tmux, fsOps: mockFs(), listProcesses: () => [], sleep: async () => {}, launchPath,
      detectDaemonSupport: async () => ({ kind: "legacy" as const }),
    });
    await adapter.launchHarness(binding(), { name: "dev-qa@test-rig" });
    return (tmux.sendText as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[1]));
  }

  it("writes the PATH in POSIX form so the pane's bash can find codex", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const commands = await launchCommands("C:\\Users\\me\\bin;D:\\tools");

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("env PATH='/mingw64/bin:/usr/bin:/c/Users/me/bin:/d/tools' codex");
  });

  it("leaves the PATH untouched elsewhere", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    const commands = await launchCommands("/usr/local/bin:/usr/bin");

    expect(commands[0]).toContain("env PATH='/usr/local/bin:/usr/bin' codex");
  });
});
