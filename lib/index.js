import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { syncEdits } from "./source-sync.js";
import { createWorkspaceDomain } from "./workspace.js";
const execFileAsync = promisify(execFile);
const name = "dsh.nudge";
const inject = ["fs", "sessions"];
const REMOTE_NAMESPACE = "nudge";
const ERROR_PREFIX = "nudge: ";
const CLIENT_DEBUG_LOG_MAX_BYTES = 1e6;
const CLIENT_DEBUG_LOG_LINE_MAX = 16384;
async function appendClientDebugLog(entry) {
  try {
    const text = typeof entry === "string" ? entry : JSON.stringify(entry);
    if (typeof text !== "string" || text.length === 0) return false;
    if (text.length > CLIENT_DEBUG_LOG_LINE_MAX) return false;
    if (text.includes("\n") || text.includes("\r")) return false;
    const directory = join(homedir(), ".dsh", "nudge");
    const file = join(directory, "client-debug.log");
    await mkdir(directory, { recursive: true });
    let size = 0;
    try {
      const info = await stat(file);
      size = typeof info?.size === "number" ? info.size : 0;
    } catch {
      size = 0;
    }
    if (size > CLIENT_DEBUG_LOG_MAX_BYTES) {
      try {
        await rename(file, file + ".1");
      } catch {
      }
    }
    await appendFile(file, text + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}
const HOST_CAPABILITIES = Object.freeze(["structure-v1", "insert", "handle", "candidates"]);
const DEFAULT_CONFIG = Object.freeze({
  language: "auto",
  enableAnnotate: true,
  enableEdit: true,
  enableDomTree: true,
  enableWorkspaceVersions: true,
  enableFloatingComposer: true,
  enableHotReload: true,
  contextMenuLink: true,
  contextMenuTab: true,
  sourceRoot: "",
  urlRoot: "",
  maxScanFiles: 400,
  maxFileBytes: 2e6
});
const LANGUAGES = Object.freeze(["auto", "zh", "en"]);
function nativeConfigNode(type, meta) {
  return { [/* @__PURE__ */ Symbol.for("schemastery")]: true, type, meta: meta || {} };
}
const Config = nativeConfigNode("object", {
  default: { ...DEFAULT_CONFIG },
  description: "dsh.nudge configuration."
});
Config.dict = {
  language: nativeConfigNode("string", {
    default: DEFAULT_CONFIG.language,
    description: "Plugin UI language: auto (follow DSH), zh, or en."
  }),
  enableAnnotate: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.enableAnnotate,
    description: "Show the annotation mode in the Nudge toolbar."
  }),
  enableEdit: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.enableEdit,
    description: "Show the live style/text editing mode in the Nudge toolbar."
  }),
  enableDomTree: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.enableDomTree,
    description: "Show the DOM tree dock in the Nudge toolbar."
  }),
  enableWorkspaceVersions: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.enableWorkspaceVersions,
    description: "Show the workspace versions / git commit dock in the Nudge toolbar."
  }),
  enableFloatingComposer: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.enableFloatingComposer,
    description: "Keep the conversation composer floating above the right Sidebar while a Nudge tab is fullscreen."
  }),
  enableHotReload: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.enableHotReload,
    description: "Enable the workspace file watcher and the automatic page reload."
  }),
  contextMenuLink: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.contextMenuLink,
    description: 'Add "Open in Nudge" to the link (and message-link) right-click menu.'
  }),
  contextMenuTab: nativeConfigNode("boolean", {
    default: DEFAULT_CONFIG.contextMenuTab,
    description: 'Add "Open in Nudge" to the browser tab actions menu.'
  }),
  sourceRoot: nativeConfigNode("string", {
    default: DEFAULT_CONFIG.sourceRoot,
    description: "Directory that page URLs map into. Empty uses the session working directory. A path outside the session workspace is ignored."
  }),
  urlRoot: nativeConfigNode("string", {
    default: DEFAULT_CONFIG.urlRoot,
    description: "URL prefix that maps to sourceRoot (for example http://127.0.0.1:4173/). Empty derives it from the page origin."
  }),
  maxScanFiles: nativeConfigNode("number", {
    default: DEFAULT_CONFIG.maxScanFiles,
    min: 20,
    max: 5e3,
    step: 1,
    description: "Maximum number of source files inspected when a page URL cannot be mapped directly."
  }),
  maxFileBytes: nativeConfigNode("number", {
    default: DEFAULT_CONFIG.maxFileBytes,
    min: 16384,
    max: 16e6,
    step: 1,
    description: "Maximum size of one source file the sync step may read."
  })
};
const configStandardSchema = {
  version: 1,
  vendor: "dsh.nudge",
  validate(value) {
    return { value: normalizeConfig(value) };
  }
};
Config["~standard"] = configStandardSchema;
function normalizeConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const text = (candidate, fallback) => typeof candidate === "string" ? candidate.trim() : fallback;
  const number = (candidate, fallback, min, max) => {
    const parsed = typeof candidate === "number" ? candidate : NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  };
  const bool = (candidate, fallback) => typeof candidate === "boolean" ? candidate : fallback;
  const language = LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language;
  return {
    language,
    enableAnnotate: bool(raw.enableAnnotate, DEFAULT_CONFIG.enableAnnotate),
    enableEdit: bool(raw.enableEdit, DEFAULT_CONFIG.enableEdit),
    enableDomTree: bool(raw.enableDomTree, DEFAULT_CONFIG.enableDomTree),
    enableWorkspaceVersions: bool(raw.enableWorkspaceVersions, DEFAULT_CONFIG.enableWorkspaceVersions),
    enableFloatingComposer: bool(raw.enableFloatingComposer, DEFAULT_CONFIG.enableFloatingComposer),
    enableHotReload: bool(raw.enableHotReload, DEFAULT_CONFIG.enableHotReload),
    contextMenuLink: bool(raw.contextMenuLink, DEFAULT_CONFIG.contextMenuLink),
    contextMenuTab: bool(raw.contextMenuTab, DEFAULT_CONFIG.contextMenuTab),
    sourceRoot: text(raw.sourceRoot, DEFAULT_CONFIG.sourceRoot),
    urlRoot: text(raw.urlRoot, DEFAULT_CONFIG.urlRoot),
    maxScanFiles: number(raw.maxScanFiles, DEFAULT_CONFIG.maxScanFiles, 20, 5e3),
    maxFileBytes: number(raw.maxFileBytes, DEFAULT_CONFIG.maxFileBytes, 16384, 16e6)
  };
}
const SETTINGS_FIELDS = Object.freeze([
  "language",
  "enableAnnotate",
  "enableEdit",
  "enableDomTree",
  "enableWorkspaceVersions",
  "enableFloatingComposer",
  "enableHotReload",
  "contextMenuLink",
  "contextMenuTab"
]);
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD_ARTIFACTS = Object.freeze(["client.js", "index.js", "runtime.js", "workspace.js"]);
function reasonOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
function remoteError(error) {
  const text = reasonOf(error);
  return new Error(ERROR_PREFIX + text.replace(/^nudge:\s*/, ""));
}
async function readPluginFacts() {
  let version = "0.0.0";
  try {
    const raw = await readFile(join(PACKAGE_ROOT, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && typeof parsed.version === "string") {
      version = parsed.version;
    }
  } catch {
  }
  const builds = [];
  for (const artifact of BUILD_ARTIFACTS) {
    try {
      const info = await stat(join(PACKAGE_ROOT, "lib", artifact));
      builds.push({ name: artifact, mtime: info.mtimeMs, size: info.size });
    } catch {
    }
  }
  return { version, pluginRoot: PACKAGE_ROOT, builds };
}
async function readGitFacts() {
  const run = async (args) => {
    const result = await execFileAsync("git", args, {
      cwd: PACKAGE_ROOT,
      timeout: 5e3,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    });
    return String(result.stdout || "").trim();
  };
  try {
    const branch = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = await run(["rev-parse", "--short", "HEAD"]);
    const status = await run(["status", "--porcelain"]);
    let remote = null;
    try {
      remote = await run(["remote", "get-url", "origin"]) || null;
    } catch {
      remote = null;
    }
    return { available: true, branch, commit, dirty: status.length > 0, remote };
  } catch (error) {
    return { available: false, error: reasonOf(error) };
  }
}
async function checkPluginUpdates(ctx) {
  const manager = ctx.get("pluginManager");
  if (manager === void 0 || manager === null || typeof manager.listVersions !== "function") {
    return { status: "unavailable", reason: "plugin-manager-unavailable" };
  }
  try {
    const result = await manager.listVersions(name);
    if (result !== null && typeof result === "object" && result.status === "listed") {
      const versions = Array.isArray(result.versions) ? result.versions : [];
      const latest = versions.length > 0 ? versions[0] : void 0;
      return {
        status: latest === void 0 ? "current" : "available",
        installed: result.installed,
        latest: latest === void 0 ? void 0 : latest.version,
        versions: versions.map((entry) => entry.version),
        registry: result.registry
      };
    }
    return {
      status: "unavailable",
      reason: result !== null && typeof result === "object" ? result.problem : "unknown",
      message: result !== null && typeof result === "object" ? result.reason : void 0
    };
  } catch (error) {
    return { status: "error", message: reasonOf(error) };
  }
}
function updateFailureMessage(outcome) {
  const error = outcome !== null && typeof outcome === "object" ? outcome.error : void 0;
  if (error === void 0 || error === null) return "the DSH plugin manager did not report a reason";
  if (typeof error === "string") return error;
  const parts = [];
  if (typeof error.diagnostic === "string" && error.diagnostic !== "") parts.push(error.diagnostic);
  if (typeof error.code === "string" && error.code !== "") parts.push("(" + error.code + ")");
  if (Array.isArray(error.incompatible) && error.incompatible.length > 0) {
    parts.push("incompatible: " + error.incompatible.map((item) => String(item && item.name ? item.name : item)).join(", "));
  }
  return parts.length > 0 ? parts.join(" ") : "update failed";
}
function pathApiFor(path) {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(path) || path.includes("\\") ? win32 : posix;
}
function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  function requireSession(sessionId) {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("a session id is required");
    }
    const session = ctx.sessions.get(sessionId);
    if (session === void 0 || session === null) {
      throw new Error("session " + JSON.stringify(sessionId) + " is not live in this harness process");
    }
    return session;
  }
  function sessionCwd(session) {
    const wd = ctx.get("workingDirectory");
    if (wd !== void 0 && wd !== null && typeof wd.get === "function") {
      try {
        const value = wd.get(session);
        if (typeof value === "string" && value.length > 1) return value;
      } catch {
      }
    }
    const headerCwd = session?.header?.cwd;
    if (typeof headerCwd === "string" && isAbsolute(headerCwd)) return headerCwd;
    const sandbox = ctx.get("sandboxPolicy");
    if (sandbox !== void 0 && sandbox !== null) {
      try {
        const policy = sandbox.resolve({ session });
        if (typeof policy?.workspaceRoot === "string") return policy.workspaceRoot;
      } catch {
      }
    }
    return void 0;
  }
  function sessionPolicy(session) {
    const sandbox = ctx.get("sandboxPolicy");
    if (sandbox !== void 0 && sandbox !== null && typeof sandbox.resolve === "function") {
      try {
        const policy = sandbox.resolve({ session });
        return {
          mode: String(policy?.mode ?? "read-only"),
          workspaceRoot: String(policy?.workspaceRoot ?? sessionCwd(session) ?? "")
        };
      } catch {
      }
    }
    return { mode: "read-only", workspaceRoot: sessionCwd(session) ?? "" };
  }
  async function resolveSourceRoot(session, cwd) {
    const fs = ctx.fs;
    const cwdTarget = await fs.resolve(cwd);
    const candidate = config.sourceRoot === "" ? cwd : config.sourceRoot;
    let absolute = candidate;
    if (!isAbsolute(absolute)) {
      absolute = pathApiFor(cwd).join(cwd, candidate);
    }
    const target = await fs.resolve(absolute);
    if (!fs.contains(cwdTarget, target)) {
      return { root: cwd, absolute: cwd, configured: false, inside: false };
    }
    const info = await fs.stat(target);
    if (info === void 0 || info === null || info.type !== "directory") {
      return { root: cwd, absolute: cwd, configured: false, inside: false };
    }
    return {
      root: fs.processPath(target),
      absolute: fs.processPath(target),
      configured: config.sourceRoot !== "",
      inside: true
    };
  }
  const workspace = createWorkspaceDomain({
    ctx,
    config,
    requireSession,
    sessionCwd,
    sessionPolicy,
    resolveSourceRoot,
    pathApiFor
  });
  ctx.effect(() => () => workspace.dispose());
  function configEditorBinding() {
    const editor = ctx.get("configEditor");
    if (editor === void 0 || editor === null || typeof editor.entries !== "function" || typeof editor.edit !== "function") {
      return void 0;
    }
    let entry;
    try {
      entry = editor.entries().find((row) => row?.options?.id === "nudge" || row?.options?.name === name) ?? void 0;
    } catch {
      entry = void 0;
    }
    if (entry === void 0) return void 0;
    return { editor, entry };
  }
  const CONFIG_FIELDS = SETTINGS_FIELDS;
  function configLayerOf(entryConfig) {
    const out = {};
    if (entryConfig === null || typeof entryConfig !== "object") return out;
    for (const key of CONFIG_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(entryConfig, key)) out[key] = entryConfig[key];
    }
    return out;
  }
  let updateSnapshot = null;
  let updateCheck = null;
  let startupChecked = false;
  function pluginManagerReady() {
    const manager = ctx.get("pluginManager");
    return manager !== void 0 && manager !== null && typeof manager.listVersions === "function";
  }
  function rememberUpdate(snapshot) {
    updateSnapshot = snapshot !== null && typeof snapshot === "object" ? snapshot : { status: "error", message: "invalid update snapshot" };
    return updateSnapshot;
  }
  function startUpdateCheck() {
    if (updateCheck !== null) return updateCheck;
    updateCheck = checkPluginUpdates(ctx).then(rememberUpdate).catch((error) => ({ status: "error", message: reasonOf(error) })).finally(() => {
      updateCheck = null;
    });
    return updateCheck;
  }
  if (typeof ctx.inject === "function") {
    ctx.inject(["pluginManager"], () => {
      if (!pluginManagerReady()) return;
      if (startupChecked || updateSnapshot !== null) return;
      startupChecked = true;
      startUpdateCheck();
    });
  }
  const api = {
    /** Liveness probe used by the panel's connection pill. */
    async ping() {
      return { ok: true, version: "0.1.0", capabilities: HOST_CAPABILITIES.slice() };
    },
    /**
     * Client diagnostics sink: append one JSONL record to
     * `~/.dsh/nudge/client-debug.log`. Never throws, so no diagnostics failure
     * can leak into the composer's send path.
     */
    async debugLog(entry) {
      const saved = await appendClientDebugLog(entry);
      return { saved };
    },
    /**
     * Settings page snapshot: the effective product preferences (language and
     * the feature/context-menu switches), their schema defaults, and whether
     * this deployment lets a user write them. `overridden` names the fields the
     * profile patch currently pins explicitly.
     */
    async config() {
      try {
        const binding = configEditorBinding();
        const layer = binding === void 0 ? {} : configLayerOf(binding.entry.options?.config);
        const values = normalizeConfig({ ...config, ...layer });
        const productValues = {};
        const defaults = {};
        for (const key of CONFIG_FIELDS) {
          productValues[key] = values[key];
          defaults[key] = DEFAULT_CONFIG[key];
        }
        return {
          values: productValues,
          defaults,
          overridden: Object.keys(layer),
          writable: binding !== void 0,
          source: binding === void 0 ? "loader" : "profile"
        };
      } catch (error) {
        throw remoteError(error);
      }
    },
    /**
     * Persist a partial config patch into the profile layer. Only the product
     * preferences are accepted; everything else in the patch is ignored so a
     * stale Client cannot resurrect removed or foreign keys.
     */
    async configUpdate(patch) {
      try {
        const binding = configEditorBinding();
        if (binding === void 0) {
          throw new Error("the profile configuration editor is not available in this deployment");
        }
        const input = patch !== null && typeof patch === "object" ? patch : {};
        const fields = configLayerOf(input);
        const productValues = (source) => {
          const out = {};
          for (const key of CONFIG_FIELDS) out[key] = source[key];
          return out;
        };
        if (Object.keys(fields).length === 0) {
          const current = normalizeConfig({ ...config, ...configLayerOf(binding.entry.options?.config) });
          return { values: productValues(current), saved: false };
        }
        const next = normalizeConfig({ ...config, ...fields });
        const accepted = {};
        for (const key of Object.keys(fields)) accepted[key] = next[key];
        await binding.editor.edit(binding.entry, (current) => ({
          ...current !== null && typeof current === "object" ? current : {},
          ...accepted
        }));
        return { values: productValues(next), saved: true };
      } catch (error) {
        throw remoteError(error);
      }
    },
    /**
     * Settings → 关于与更新 snapshot: package version, build artifact times,
     * local git facts, runtime facts and the published-version state.
     *
     * `check === true` forces a fresh registry lookup (the manual “检查更新”
     * button). Otherwise the startup snapshot is returned, so opening the page
     * shows the result immediately; a page opened before the startup check
     * finished lazily runs the same single cached check.
     *
     * Designed for the local-link development install: it never claims a newer
     * version exists when the plugin manager reports the install as not
     * updatable.
     */
    async about(check) {
      try {
        const facts = await readPluginFacts();
        const git = await readGitFacts();
        let update;
        if (check === true) {
          update = rememberUpdate(await checkPluginUpdates(ctx));
        } else if (updateSnapshot !== null) {
          update = updateSnapshot;
        } else if (updateCheck !== null) {
          update = await updateCheck;
        } else if (pluginManagerReady()) {
          update = await startUpdateCheck();
        } else {
          update = { status: "unchecked" };
        }
        return {
          name,
          version: facts.version,
          pluginRoot: facts.pluginRoot,
          builds: facts.builds,
          git,
          update,
          runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch
          }
        };
      } catch (error) {
        throw remoteError(error);
      }
    },
    /**
     * Settings → 关于与更新: install the newest published version.
     *
     * 为什么只走 pluginManager.updateBundle，而不是自己 npm install：
     * - updateBundle 只对“从 npm registry 安装、且 spec 就是包名本身”的包生效；
     *   link/本地开发安装会被 manager 以 not-updatable 拒绝，这里返回 failed，
     *   设置页显示原因，绝不悄悄改动开发环境。
     * - 卸载旧版、安装精确新版、DSH 版本兼容性校验，以及失败后的回滚都由 DSH
     *   负责；本插件只把结果翻译成页面能展示的 status/message。
     * - 任何异常都收敛为 { status: 'failed' }，不向 RPC 抛错，避免设置页崩溃。
     */
    async update(version) {
      let manager;
      try {
        manager = ctx.get("pluginManager");
      } catch (error) {
        return { status: "failed", message: reasonOf(error) };
      }
      if (manager === void 0 || manager === null || typeof manager.updateBundle !== "function") {
        return { status: "failed", message: "the DSH plugin manager is not available" };
      }
      const installed = updateSnapshot !== null && typeof updateSnapshot.installed === "string" ? updateSnapshot.installed : void 0;
      const requested = typeof version === "string" ? version.trim() : "";
      const snapshotLatest = updateSnapshot !== null && typeof updateSnapshot.latest === "string" ? updateSnapshot.latest : "";
      const target = requested !== "" ? requested : snapshotLatest;
      if (target === "") return { status: "failed", message: "a published version is required" };
      const requestId = "nudge-update-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      try {
        const result = await manager.updateBundle(name, target, { requestId });
        const outcome = result !== null && typeof result === "object" && result.result !== null && typeof result.result === "object" ? result.result : {};
        const application = typeof outcome.application === "string" ? outcome.application : "failed";
        const from = result !== null && typeof result === "object" && typeof result.from === "string" ? result.from : installed;
        const to = result !== null && typeof result === "object" && typeof result.to === "string" ? result.to : target;
        if (application === "applied" || application === "restart-required") {
          updateSnapshot = {
            status: "current",
            installed: to,
            latest: void 0,
            versions: [],
            registry: updateSnapshot === null ? void 0 : updateSnapshot.registry
          };
          return {
            status: application === "applied" ? "updated" : "restart-required",
            from,
            to,
            restart: application !== "applied"
          };
        }
        if (application === "cancelled") {
          return { status: "failed", from, to, message: "the update was cancelled" };
        }
        return {
          status: "failed",
          from,
          to,
          message: updateFailureMessage(outcome),
          // updateBundle 在 HMR 卸载旧版后安装失败时会重新装回旧版。
          restored: result !== null && typeof result === "object" && result.restore !== void 0 && result.restore !== null
        };
      } catch (error) {
        return { status: "failed", from: installed, to: target, message: reasonOf(error) };
      }
    },
    /** Session facts for the panel: cwd, policy, mapping defaults. */
    async session(sessionId) {
      try {
        const session = requireSession(sessionId);
        const cwd = sessionCwd(session);
        if (typeof cwd !== "string" || cwd.length === 0) {
          throw new Error("this session has no working directory");
        }
        const policy = sessionPolicy(session);
        const root = await resolveSourceRoot(session, cwd);
        const sessionHeader = session.header ?? {};
        return {
          sessionId,
          cwd,
          sourceRoot: root.root,
          sourceRootConfigured: root.configured,
          urlRoot: config.urlRoot,
          policy,
          writable: policy.mode !== "read-only",
          createdAt: typeof sessionHeader.createdAt === "number" ? sessionHeader.createdAt : null
        };
      } catch (error) {
        throw remoteError(error);
      }
    },
    /**
     * Persist one batch of live visual edits.
     * `edits` is an array of plain JSON edit records produced by the page
     * runtime; every result keeps the same `id`.
     */
    async sync(sessionId, page, edits) {
      try {
        const session = requireSession(sessionId);
        const cwd = sessionCwd(session);
        if (typeof cwd !== "string" || cwd.length === 0) {
          throw new Error("this session has no working directory");
        }
        if (!Array.isArray(edits) || edits.length === 0) {
          return { results: [], syncedAt: Date.now() };
        }
        const policy = sessionPolicy(session);
        const root = await resolveSourceRoot(session, cwd);
        if (policy.mode === "read-only") {
          return {
            results: edits.map((edit) => ({
              id: String(edit?.id ?? ""),
              status: "preview",
              reason: "read-only-policy"
            })),
            syncedAt: Date.now(),
            writable: false
          };
        }
        const outcome = await syncEdits({
          fs: ctx.fs,
          cwd,
          sourceRoot: root.root,
          urlRoot: config.urlRoot,
          page: page && typeof page === "object" ? page : {},
          edits,
          policy,
          maxScanFiles: config.maxScanFiles,
          maxFileBytes: config.maxFileBytes
        });
        return { ...outcome, syncedAt: Date.now(), writable: true };
      } catch (error) {
        throw remoteError(error);
      }
    },
    /**
     * Materialise one annotation screenshot under the workspace so the agent
     * can read it with its normal file tools.
     */
    async saveScreenshot(sessionId, annotationId, dataUrl) {
      try {
        const session = requireSession(sessionId);
        const cwd = sessionCwd(session);
        if (typeof cwd !== "string" || cwd.length === 0) {
          throw new Error("this session has no working directory");
        }
        if (typeof dataUrl !== "string") throw new Error("a PNG data URL is required");
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUrl);
        if (match === null) throw new Error("only base64 PNG screenshots are accepted");
        const bytes = Buffer.from(match[1], "base64");
        if (bytes.length === 0 || bytes.length > 8e6) throw new Error("screenshot size is out of range");
        const safeId = String(annotationId ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "shot";
        const policy = sessionPolicy(session);
        if (policy.mode === "read-only") throw new Error("the current session policy does not allow writing screenshots");
        const directory = pathApiFor(cwd).join(cwd, ".dsh", "nudge", "screenshots");
        const directoryTarget = await ctx.fs.resolve(directory);
        const cwdTarget = await ctx.fs.resolve(cwd);
        if (!ctx.fs.contains(cwdTarget, directoryTarget)) throw new Error("screenshot directory is outside the workspace");
        const filePath = pathApiFor(cwd).join(directory, safeId + "-" + Date.now().toString(36) + ".png");
        const fileTarget = await ctx.fs.resolve(filePath);
        if (!ctx.fs.contains(cwdTarget, fileTarget)) throw new Error("screenshot path is outside the workspace");
        await mkdir(directory, { recursive: true });
        await writeFile(filePath, bytes);
        const relative = pathApiFor(cwd).relative(cwd, filePath) || filePath;
        return { path: filePath, relativePath: relative.replaceAll(sep, "/") };
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.1 — workspace snapshot: policy, git facts, HTML scan, preview state. */
    async workspace(sessionId) {
      try {
        return await workspace.workspace(sessionId);
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.2 — recent commits, optionally scoped to one file. */
    async gitLog(sessionId, file) {
      try {
        return await workspace.gitLog(sessionId, file);
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.3 — switch branches (dirty refusal, optional stash). */
    async gitSwitch(sessionId, branch, options) {
      try {
        return await workspace.gitSwitch(sessionId, branch, options);
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.4 — restore one file from a commit. */
    async gitRestoreFile(sessionId, file, commit) {
      try {
        return await workspace.gitRestoreFile(sessionId, file, commit);
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.5 — commit selected files or every pending change. */
    async gitCommit(sessionId, message, files) {
      try {
        return await workspace.gitCommit(sessionId, message, files);
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.6 — start (or reuse) the static preview server. */
    async previewOpen(sessionId, file) {
      try {
        return await workspace.previewOpen(sessionId, file);
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.7 — stop the static preview server and watcher. */
    async previewStop(sessionId) {
      try {
        return await workspace.previewStop(sessionId);
      } catch (error) {
        throw remoteError(error);
      }
    },
    /** §3.8 — change-watcher revision poll. */
    async watchPoll(sessionId) {
      try {
        return await workspace.watchPoll(sessionId);
      } catch (error) {
        throw remoteError(error);
      }
    }
  };
  Object.defineProperty(api, "typertRemote", {
    value: Object.freeze({
      service: api,
      serviceKey: REMOTE_NAMESPACE,
      namespace: REMOTE_NAMESPACE
    })
  });
  const remoteParam = (wire) => ({ name: wire, wire, source: "json", codec: { mode: "src-json" } });
  const remoteInvocation = (method, params) => ({
    id: "dsh.nudge#" + REMOTE_NAMESPACE + "/" + method,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters: params.map(remoteParam),
    result: { mode: "src-json" }
  });
  const REMOTE_CONTRIBUTION = {
    package: "dsh.nudge",
    face: "host",
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      remoteInvocation("ping", []),
      remoteInvocation("debugLog", ["entry"]),
      remoteInvocation("config", []),
      remoteInvocation("configUpdate", ["patch"]),
      remoteInvocation("about", ["check"]),
      remoteInvocation("update", ["version"]),
      remoteInvocation("session", ["session"]),
      remoteInvocation("sync", ["session", "page", "edits"]),
      remoteInvocation("saveScreenshot", ["session", "annotationId", "dataUrl"]),
      remoteInvocation("workspace", ["session"]),
      remoteInvocation("gitLog", ["session", "file"]),
      remoteInvocation("gitSwitch", ["session", "branch", "options"]),
      remoteInvocation("gitRestoreFile", ["session", "file", "commit"]),
      remoteInvocation("gitCommit", ["session", "message", "files"]),
      remoteInvocation("previewOpen", ["session", "file"]),
      remoteInvocation("previewStop", ["session"]),
      remoteInvocation("watchPoll", ["session"])
    ]
  };
  ctx.provide(REMOTE_NAMESPACE, api);
  ctx.inject(["typert"], (typertCtx) => typertCtx.typert.register(REMOTE_CONTRIBUTION));
}
export {
  Config,
  DEFAULT_CONFIG,
  apply,
  inject,
  name,
  normalizeConfig
};
