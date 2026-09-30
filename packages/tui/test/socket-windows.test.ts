import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import { createViewState } from "../src/state.js";
import { createControlSocket, defaultSocketPath, isNamedPipePath } from "../src/socket-server.js";
import { demoSnapshot } from "../src/demo-data.js";
import type { ControlSocket } from "../src/socket-server.js";

describe("isNamedPipePath", () => {
  it("recognises Windows pipe names", () => {
    expect(isNamedPipePath("\\\\.\\pipe\\openrig-tui-abc-kernel")).toBe(true);
    expect(isNamedPipePath("\\\\?\\pipe\\openrig-tui-abc-kernel")).toBe(true);
  });

  it("does not take files or unix paths for pipes", () => {
    expect(isNamedPipePath("C:\\Users\\me\\.openrig\\run\\tui-kernel.sock")).toBe(false);
    expect(isNamedPipePath("/home/me/.openrig/run/tui-kernel.sock")).toBe(false);
  });
});

describe("defaultSocketPath", () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const saved = { ...process.env };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { fn(); } finally { process.env = saved; }
  };

  it("names a pipe on Windows, not a file that Windows cannot listen on", () => {
    withEnv({ OPENRIG_TUI_SOCKET: undefined, OPENRIG_HOME: "C:\\Users\\me\\.openrig" }, () => {
      const p = defaultSocketPath("kernel", "win32");
      expect(isNamedPipePath(p)).toBe(true);
      expect(p).toMatch(/^\\\\\.\\pipe\\openrig-tui-[0-9a-f]{8}-kernel$/);
    });
  });

  it("gives two OpenRig homes two different pipes", () => {
    let a = ""; let b = "";
    withEnv({ OPENRIG_TUI_SOCKET: undefined, OPENRIG_HOME: "C:\\homes\\one" }, () => { a = defaultSocketPath("kernel", "win32"); });
    withEnv({ OPENRIG_TUI_SOCKET: undefined, OPENRIG_HOME: "C:\\homes\\two" }, () => { b = defaultSocketPath("kernel", "win32"); });
    expect(a).not.toBe(b);
  });

  it("ignores case in the home, as Windows paths do", () => {
    let a = ""; let b = "";
    withEnv({ OPENRIG_TUI_SOCKET: undefined, OPENRIG_HOME: "C:\\Homes\\One" }, () => { a = defaultSocketPath("kernel", "win32"); });
    withEnv({ OPENRIG_TUI_SOCKET: undefined, OPENRIG_HOME: "c:\\homes\\one" }, () => { b = defaultSocketPath("kernel", "win32"); });
    expect(a).toBe(b);
  });

  it("keeps a path separator out of the pipe name", () => {
    withEnv({ OPENRIG_TUI_SOCKET: undefined, OPENRIG_HOME: "C:\\h" }, () => {
      expect(defaultSocketPath("a/b\\c", "win32")).toMatch(/-a_b_c$/);
    });
  });

  it("leaves the unix socket path alone elsewhere", () => {
    withEnv({ OPENRIG_TUI_SOCKET: undefined, OPENRIG_HOME: "/home/me/.openrig" }, () => {
      expect(defaultSocketPath("kernel", "linux").replace(/\\/g, "/")).toBe("/home/me/.openrig/run/tui-kernel.sock");
      expect(defaultSocketPath("kernel", "darwin").replace(/\\/g, "/")).toBe("/home/me/.openrig/run/tui-kernel.sock");
    });
  });

  it("still honours the explicit override", () => {
    withEnv({ OPENRIG_TUI_SOCKET: "\\\\.\\pipe\\mine" }, () => {
      expect(defaultSocketPath("kernel", "win32")).toBe("\\\\.\\pipe\\mine");
    });
  });
});

// A real listen: only Windows can exercise a named pipe.
describe.skipIf(process.platform !== "win32")("control socket over a Windows named pipe", () => {
  let open: ControlSocket | null = null;
  afterEach(async () => { if (open) await open.close(); open = null; });

  it("listens, answers a state query and closes without touching the filesystem", async () => {
    const view = createViewState({ instanceId: "tui-pipe", getSnapshot: () => demoSnapshot() });
    const pipe = `\\\\.\\pipe\\openrig-tui-test-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
    open = await createControlSocket({ socketPath: pipe, view });

    const reply = await new Promise<string>((resolve, reject) => {
      const conn = net.createConnection({ path: open!.path });
      conn.on("data", (d) => { conn.end(); resolve(d.toString("utf8")); });
      conn.on("error", reject);
      conn.on("connect", () => conn.write("state\n"));
    });

    const parsed = JSON.parse(reply.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.instanceId).toBe("tui-pipe");
  });
});
