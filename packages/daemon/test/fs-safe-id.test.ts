import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeAdapter, type ClaudeAdapterFsOps } from "../src/adapters/claude-code-adapter.js";
import { CodexRuntimeAdapter, type CodexAdapterFsOps } from "../src/adapters/codex-runtime-adapter.js";
import { fromFsSafeName, toFsSafeName } from "../src/domain/fs-safe-id.js";
import type { ProjectionEntry, ProjectionPlan } from "../src/domain/projection-planner.js";
import type { NodeBinding } from "../src/domain/types.js";

describe("toFsSafeName / fromFsSafeName", () => {
  it("leaves ids unchanged off Windows, so existing installs do not move", () => {
    expect(toFsSafeName("shared:openrig-core", "linux")).toBe("shared:openrig-core");
    expect(toFsSafeName("shared:openrig-core", "darwin")).toBe("shared:openrig-core");
    expect(fromFsSafeName("shared:openrig-core", "linux")).toBe("shared:openrig-core");
  });

  it("escapes the colon of a qualified id on Windows", () => {
    expect(toFsSafeName("shared:openrig-core", "win32")).toBe("shared%3Aopenrig-core");
  });

  it("leaves already-safe ids alone on Windows", () => {
    for (const id of ["openrig-core", "my_skill.v2", "a-b-c"]) {
      expect(toFsSafeName(id, "win32")).toBe(id);
    }
  });

  it("never emits a character Windows forbids in a file name", () => {
    const encoded = toFsSafeName('a<b>c:d"e|f?g*h%i', "win32");
    expect(encoded).not.toMatch(/[<>:"|?*]/);
  });

  it("round-trips ids, including ones that already contain a percent sign", () => {
    for (const id of ["shared:openrig-core", "100%3A", "a%b:c", 'x<y>:"z|w?v*u', "plain"]) {
      expect(fromFsSafeName(toFsSafeName(id, "win32"), "win32")).toBe(id);
    }
  });

  it("only decodes the escapes it produces", () => {
    expect(fromFsSafeName("report%20final", "win32")).toBe("report%20final");
  });

  it("defaults to the running platform", () => {
    expect(toFsSafeName("shared:x")).toBe(process.platform === "win32" ? "shared%3Ax" : "shared:x");
  });
});

// ---- adapter projection with a qualified id, as it happens on a Windows host ----

const norm = (p: string) => p.replace(/\\/g, "/");

function mockTmux() {
  return {
    sessionExists: vi.fn().mockResolvedValue(true),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    capturePaneContent: vi.fn().mockResolvedValue(""),
    getPaneCommand: vi.fn().mockResolvedValue(""),
    listSessions: vi.fn().mockResolvedValue([]),
    runCommandInSession: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    setEnvVar: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof ClaudeCodeAdapter>[0]["tmux"];
}

function mockFs(files: Record<string, string>) {
  const store: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) store[norm(k)] = v;
  return {
    readFile: (p: string) => { if (norm(p) in store) return store[norm(p)]!; throw new Error(`Not found: ${p}`); },
    writeFile: (p: string, c: string) => { store[norm(p)] = c; },
    exists: (p: string) => norm(p) in store || Object.keys(store).some((k) => k.startsWith(norm(p) + "/")),
    mkdirp: () => {},
    copyFile: () => {},
    listFiles: (dir: string) => Object.keys(store)
      .filter((k) => k.startsWith(norm(dir) + "/"))
      .map((k) => k.slice(norm(dir).length + 1)),
    _store: store,
  };
}

const TREE = {
  "/p/openrig-core/.claude-plugin/plugin.json": '{"name":"openrig-core"}',
  "/p/openrig-core/.codex-plugin/plugin.json": '{"name":"openrig-core"}',
  "/p/openrig-core/README.md": "# openrig-core",
};

function pluginEntry(id: string): ProjectionEntry {
  return {
    category: "plugin",
    effectiveId: id,
    sourceSpec: "test-spec",
    sourcePath: "/specs/test-spec",
    resourcePath: "/p/openrig-core",
    absolutePath: "/p/openrig-core",
    classification: "safe_projection",
  };
}

function plan(entries: ProjectionEntry[]): ProjectionPlan {
  return { runtime: "claude-code", cwd: "/cwd", entries, startup: { files: [], actions: [] }, conflicts: [], noOps: [], diagnostics: [] };
}

const binding: NodeBinding = {
  id: "b1", nodeId: "n1", tmuxSession: "test", tmuxWindow: null, tmuxPane: null,
  cmuxWorkspace: null, cmuxSurface: null, updatedAt: "", cwd: "/cwd",
};

describe("projecting a qualified id on a Windows host", () => {
  const realPlatform = process.platform;
  beforeEach(() => { Object.defineProperty(process, "platform", { value: "win32" }); });
  afterEach(() => { Object.defineProperty(process, "platform", { value: realPlatform }); });

  it("Codex lands the plugin in a colon-free directory", async () => {
    const fs = mockFs(TREE);
    const adapter = new CodexRuntimeAdapter({ tmux: mockTmux(), fsOps: fs as unknown as CodexAdapterFsOps });

    const result = await adapter.project(plan([pluginEntry("shared:openrig-core")]), binding);

    expect(result.failed).toEqual([]);
    expect(fs._store["/cwd/.codex/plugins/shared%3Aopenrig-core/README.md"]).toBe("# openrig-core");
    expect(Object.keys(fs._store).some((k) => k.startsWith("/cwd/.codex/plugins/shared:"))).toBe(false);
  });

  it("Claude lands the plugin in a colon-free directory", async () => {
    const fs = mockFs(TREE);
    const adapter = new ClaudeCodeAdapter({ tmux: mockTmux(), fsOps: fs as unknown as ClaudeAdapterFsOps });

    const result = await adapter.project(plan([pluginEntry("shared:openrig-core")]), binding);

    expect(result.failed).toEqual([]);
    expect(fs._store["/cwd/.claude/plugins/shared%3Aopenrig-core/README.md"]).toBe("# openrig-core");
  });

  it("Codex listInstalled reports the original id for an escaped skill directory", async () => {
    const fs = mockFs({ "/cwd/.agents/skills/shared%3Amy-skill": "dir-entry" });
    const adapter = new CodexRuntimeAdapter({ tmux: mockTmux(), fsOps: fs as unknown as CodexAdapterFsOps });

    const installed = await adapter.listInstalled(binding);

    expect(installed.map((r) => r.effectiveId)).toContain("shared:my-skill");
  });
});
