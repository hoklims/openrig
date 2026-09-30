import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    options: Record<string, unknown>,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    calls.push({ file, args, options });
    callback(null, "Usage: codex [OPTIONS]\n  --no-daemon  do not share an app-server daemon\n");
  },
}));

const { codexDaemonSupportProbe, codexHelpNeedsShell } = await import("../src/domain/codex-daemon-support.js");

describe("codex --help probe on Windows", () => {
  const realPlatform = process.platform;
  beforeEach(() => { calls.length = 0; });
  afterEach(() => { Object.defineProperty(process, "platform", { value: realPlatform }); });

  it("needs a shell only on win32, where npm installs codex as codex.cmd", () => {
    expect(codexHelpNeedsShell("win32")).toBe(true);
    expect(codexHelpNeedsShell("linux")).toBe(false);
    expect(codexHelpNeedsShell("darwin")).toBe(false);
  });

  it("runs the fixed command through a shell on win32", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const support = await codexDaemonSupportProbe()("/seat");

    expect(support).toEqual({ kind: "supported" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe("codex");
    expect(calls[0]!.args).toEqual(["--help"]);
    expect(calls[0]!.options.shell).toBe(true);
  });

  it("does not use a shell elsewhere", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    await codexDaemonSupportProbe()("/seat");

    expect(calls[0]!.options.shell).toBe(false);
  });
});
