// src/host/domains/workspace/files.ts
import { readdir, stat } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/host/domains/workspace/paths.ts
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { realpath } from "node:fs/promises";
var IGNORED_DIRECTORY_NAMES = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
  ".dsh"
]);
function isIgnoredName(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  if (IGNORED_DIRECTORY_NAMES.has(name)) return true;
  return name.startsWith(".");
}
function isInsideOrEqual(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string") return false;
  const rel = relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function relativePosix(from, to) {
  if (typeof from !== "string" || typeof to !== "string" || from.length === 0 || to.length === 0) return null;
  const rel = relative(from, to);
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}
function normalizeRelativePath(input, label = "path") {
  if (typeof input !== "string") throw new Error(label + " must be a string");
  const value = input.trim();
  if (value.length === 0) throw new Error(label + " must not be empty");
  if (value.includes("\0")) throw new Error(label + " must not contain NUL characters");
  if (value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(label + " must be relative to the source root");
  }
  if (value.includes("\\")) throw new Error(label + " must use / as the path separator");
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(label + " must be a normalised relative path");
    }
    if (segment.toLowerCase() === ".git") {
      throw new Error(label + " must not point inside .git");
    }
  }
  return segments.join("/");
}
async function realpathWithinRoot(rootReal, absolutePath) {
  const root = String(rootReal);
  let cursor = String(absolutePath);
  const tail = [];
  for (let guard = 0; guard < 128; guard += 1) {
    try {
      const real = await realpath(cursor);
      const resolved = tail.length > 0 ? join(real, ...tail.slice().reverse()) : real;
      return isInsideOrEqual(root, resolved) ? resolved : null;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) return null;
      tail.push(basename(cursor));
      cursor = parent;
    }
  }
  return null;
}

// src/host/domains/workspace/files.ts
var HTML_EXTENSIONS = /* @__PURE__ */ new Set([".html", ".htm"]);
var DEFAULT_MAX_SCAN_FILES = 400;
var MAX_DEPTH = 10;
function isHtmlName(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return HTML_EXTENSIONS.has(name.slice(dot).toLowerCase());
}
async function statFile(absolutePath) {
  try {
    return await stat(absolutePath);
  } catch {
    return void 0;
  }
}
async function scanHtmlFiles({ sourceRoot, maxScanFiles }) {
  const budget = typeof maxScanFiles === "number" && Number.isFinite(maxScanFiles) && maxScanFiles > 0 ? Math.floor(maxScanFiles) : DEFAULT_MAX_SCAN_FILES;
  const files = [];
  let truncated = false;
  async function walk(absoluteDir, relativeDir, depth) {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (isIgnoredName(entry.name)) continue;
      const relativePath = relativeDir ? relativeDir + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) continue;
        await walk(join2(absoluteDir, entry.name), relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isHtmlName(entry.name)) continue;
      if (files.length >= budget) {
        truncated = true;
        return;
      }
      const info = await statFile(join2(absoluteDir, entry.name));
      if (info === void 0) continue;
      files.push({
        path: relativePath,
        name: entry.name,
        dir: relativeDir,
        size: info.size,
        mtime: Math.floor(info.mtimeMs),
        change: null
      });
    }
  }
  await walk(sourceRoot, "", 0);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, truncated };
}

// src/host/domains/workspace/git.ts
import { execFile } from "node:child_process";
import { realpath as realpath2 } from "node:fs/promises";
import { join as join3 } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var GIT_TIMEOUT_MS = 2e4;
var GIT_MAX_BUFFER = 8 * 1024 * 1024;
var LOG_LIMIT = 40;
var COMMIT_MESSAGE_LIMIT = 4e3;
var FAILURE_TEXT_LIMIT = 800;
var COMMIT_PATTERN = /^[0-9a-fA-F]{4,40}$/;
var GitCommandError = class extends Error {
  constructor(message, facts) {
    super(message);
    this.name = "GitCommandError";
    this.exitCode = facts.exitCode;
    this.stdout = facts.stdout;
    this.stderr = facts.stderr;
    this.spawnCode = facts.spawnCode;
  }
};
function firstLine(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.length > 0 ? lines[0] : "";
}
async function runGit(cwd, args, options = {}) {
  const readOnly = options.readOnly === true;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (readOnly) env.GIT_OPTIONAL_LOCKS = "0";
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
      windowsHide: true,
      env
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const spawnCode = typeof error?.code === "string" ? error.code : void 0;
    const exitCode = typeof error?.code === "number" ? error.code : null;
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    let message;
    if (spawnCode === "ENOENT") {
      message = "git is not available on this machine";
    } else {
      const detail = firstLine(stderr) || firstLine(stdout) || String(error?.message || "unknown git failure");
      message = "git " + String(args[0] || "") + " failed: " + detail;
    }
    throw new GitCommandError(message, { spawnCode, exitCode, stdout, stderr });
  }
}
function failureText(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  let text = stderr || stdout || (error instanceof Error ? error.message : String(error));
  if (text.length > FAILURE_TEXT_LIMIT) text = text.slice(0, FAILURE_TEXT_LIMIT) + "\u2026";
  return text;
}
function unavailableGit(error) {
  return {
    available: false,
    repoRoot: "",
    relativeRoot: "",
    sourceSubdir: "",
    branch: "",
    detached: false,
    branches: [],
    clean: true,
    changes: [],
    error
  };
}
function repoPathFor(mapping, sourcePath) {
  if (mapping.sourceSubdir) return mapping.sourceSubdir + "/" + sourcePath;
  if (mapping.relativeRoot) {
    const prefix = mapping.relativeRoot + "/";
    return sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : null;
  }
  return sourcePath;
}
function sourcePathFor(mapping, repoPath) {
  if (mapping.sourceSubdir) {
    const prefix = mapping.sourceSubdir + "/";
    return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
  }
  if (mapping.relativeRoot) return mapping.relativeRoot + "/" + repoPath;
  return repoPath;
}
async function probeRepoRoot(startDir) {
  try {
    const result = await runGit(startDir, ["rev-parse", "--show-toplevel"], { readOnly: true });
    const top = result.stdout.trim();
    if (!top) return { ok: false, reason: "not-a-repository" };
    return { ok: true, repoRoot: await realpath2(top) };
  } catch (error) {
    return { ok: false, reason: error?.spawnCode === "ENOENT" ? "git-unavailable" : "not-a-repository" };
  }
}
function classifyOverlap(cwdReal, sourceReal, repoRoot) {
  if (!isInsideOrEqual(cwdReal, repoRoot)) {
    return { available: false, error: "outside-workspace" };
  }
  if (repoRoot === sourceReal) {
    return { available: true, relativeRoot: "", sourceSubdir: "" };
  }
  if (isInsideOrEqual(repoRoot, sourceReal)) {
    return { available: true, relativeRoot: "", sourceSubdir: relativePosix(repoRoot, sourceReal) ?? "" };
  }
  if (isInsideOrEqual(sourceReal, repoRoot)) {
    return { available: true, relativeRoot: relativePosix(sourceReal, repoRoot) ?? "", sourceSubdir: "" };
  }
  return { available: false, error: "outside-workspace" };
}
async function detectRepo({ cwd, sourceRoot }) {
  let cwdReal;
  let sourceReal;
  try {
    cwdReal = await realpath2(cwd);
    sourceReal = await realpath2(sourceRoot);
  } catch {
    return { available: false, repoRoot: "", relativeRoot: "", sourceSubdir: "", error: "workspace-unavailable" };
  }
  const starts = [sourceReal];
  if (cwdReal !== sourceReal) starts.push(cwdReal);
  const seen = /* @__PURE__ */ new Set();
  for (const start of starts) {
    const probe = await probeRepoRoot(start);
    if (!probe.ok) {
      seen.add(probe.reason);
      continue;
    }
    const overlap = classifyOverlap(cwdReal, sourceReal, probe.repoRoot);
    if (overlap.available) {
      return {
        available: true,
        repoRoot: probe.repoRoot,
        relativeRoot: overlap.relativeRoot,
        sourceSubdir: overlap.sourceSubdir,
        error: null
      };
    }
    seen.add(overlap.error);
  }
  const reason = seen.has("outside-workspace") ? "outside-workspace" : seen.has("git-unavailable") ? "git-unavailable" : "not-a-repository";
  return { available: false, repoRoot: "", relativeRoot: "", sourceSubdir: "", error: reason };
}
async function readBranch(repoRoot) {
  try {
    const result = await runGit(repoRoot, ["symbolic-ref", "--short", "-q", "HEAD"], { readOnly: true });
    const branch = result.stdout.trim();
    if (branch) return { branch, detached: false };
  } catch {
  }
  return { branch: "", detached: true };
}
async function readBranches(repoRoot, currentBranch) {
  let output = "";
  try {
    const result = await runGit(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
      readOnly: true
    });
    output = result.stdout;
  } catch {
    return [];
  }
  const names = output.split("\n").map((name) => name.trim()).filter((name) => name.length > 0);
  names.sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({ name, current: name === currentBranch }));
}
function labelFor(indexCode, worktreeCode) {
  const pair = indexCode + worktreeCode;
  if (indexCode === "U" || worktreeCode === "U" || pair === "AA" || pair === "DD") return "conflicted";
  if (indexCode === "?" || worktreeCode === "?") return "untracked";
  if (indexCode === "R" || worktreeCode === "R") return "renamed";
  if (indexCode === "D" || worktreeCode === "D") return "deleted";
  if (indexCode === "A" || worktreeCode === "A" || indexCode === "C" || worktreeCode === "C") return "added";
  return "modified";
}
async function readChanges(detected) {
  const result = await runGit(
    detected.repoRoot,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { readOnly: true }
  );
  const tokens = result.stdout.split("\0");
  const changes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 4) continue;
    const indexCode = token[0];
    const worktreeCode = token[1];
    const repoPath = token.slice(3);
    if (!repoPath) continue;
    let fromPath;
    if (indexCode === "R" || indexCode === "C" || worktreeCode === "R" || worktreeCode === "C") {
      const from = tokens[index + 1];
      if (from) {
        fromPath = from;
        index += 1;
      }
    }
    const path = sourcePathFor(detected, repoPath);
    if (path === null || path === "") continue;
    const change = {
      path,
      index: indexCode,
      worktree: worktreeCode,
      label: labelFor(indexCode, worktreeCode)
    };
    const fromRelative = fromPath === void 0 ? null : sourcePathFor(detected, fromPath);
    if (fromRelative) change.from = fromRelative;
    changes.push(change);
  }
  changes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return changes;
}
async function readGitState({ cwd, sourceRoot }) {
  const detected = await detectRepo({ cwd, sourceRoot });
  if (!detected.available) return unavailableGit(detected.error);
  const repoRoot = detected.repoRoot;
  const { branch, detached } = await readBranch(repoRoot);
  const branches = await readBranches(repoRoot, branch);
  const changes = await readChanges(detected);
  return {
    available: true,
    repoRoot,
    relativeRoot: detected.relativeRoot,
    sourceSubdir: detected.sourceSubdir,
    branch,
    detached,
    branches,
    clean: changes.length === 0,
    changes,
    error: null
  };
}
async function gitLog(deps, file) {
  if (file !== void 0 && file !== null && typeof file !== "string") {
    throw new Error("file must be a string path");
  }
  const normalizedFile = typeof file === "string" && file.trim() !== "" ? normalizeRelativePath(file, "file") : "";
  const detected = await detectRepo(deps);
  if (!detected.available) return { file: normalizedFile, commits: [] };
  const args = [
    "log",
    "--max-count=" + LOG_LIMIT,
    "--date=iso-strict",
    "--format=%H%x00%h%x00%an%x00%aI%x00%s"
  ];
  if (normalizedFile) {
    const repoRelative = repoPathFor(detected, normalizedFile);
    if (repoRelative === null || repoRelative === "") return { file: normalizedFile, commits: [] };
    args.push("--", repoRelative);
  }
  let output;
  try {
    const result = await runGit(detected.repoRoot, args, { readOnly: true });
    output = result.stdout;
  } catch (error) {
    const detail = String(error?.stderr || "") + String(error?.stdout || "") + String(error?.message || "");
    if (/does not have any commits|unknown revision|bad revision/i.test(detail)) {
      return { file: normalizedFile, commits: [] };
    }
    throw error;
  }
  const commits = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const fields = line.split("\0");
    if (fields.length < 5) continue;
    commits.push({
      hash: fields[0],
      short: fields[1],
      author: fields[2],
      date: fields[3],
      subject: fields[4]
    });
  }
  return { file: normalizedFile, commits };
}
async function gitSwitch(deps, branch, options) {
  if (typeof branch !== "string" || branch.trim() === "") throw new Error("a branch name is required");
  const target = branch.trim();
  const detected = await detectRepo(deps);
  if (!detected.available) throw new Error("git is not available for this workspace (reason: " + String(detected.error) + ")");
  const repoRoot = detected.repoRoot;
  const branches = await readBranches(repoRoot, "");
  if (!branches.some((entry) => entry.name === target)) {
    throw new Error("unknown local branch " + JSON.stringify(target));
  }
  const before = await readGitState(deps);
  if (!before.detached && before.branch === target) {
    return { ok: true, branch: target, stashed: false, clean: before.clean, git: before };
  }
  const stashWanted = options !== null && typeof options === "object" && options.stash === true;
  const dirty = !before.clean;
  if (dirty && !stashWanted) return { ok: false, reason: "dirty", git: before };
  let stashed = false;
  if (dirty) {
    try {
      await runGit(repoRoot, ["stash", "push", "--include-untracked", "-m", "dsh-nudge: switch to " + target]);
      stashed = true;
    } catch (error) {
      return {
        ok: false,
        reason: "switch-failed",
        message: "could not stash the working tree: " + failureText(error),
        git: before
      };
    }
  }
  try {
    await runGit(repoRoot, ["switch", target]);
  } catch (error) {
    let note = "";
    if (stashed) {
      try {
        await runGit(repoRoot, ["stash", "pop"]);
        note = "; the stashed changes were restored";
      } catch (restoreError) {
        note = "; the stashed changes could not be restored: " + failureText(restoreError);
      }
    }
    const after2 = await readGitState(deps);
    return {
      ok: false,
      reason: "switch-failed",
      message: failureText(error) + note,
      git: after2
    };
  }
  const after = await readGitState(deps);
  return { ok: true, branch: target, stashed, clean: after.clean, git: after };
}
async function gitRestoreFile(deps, file, commit) {
  const normalizedFile = normalizeRelativePath(file, "file");
  const targetCommit = String(commit ?? "").trim();
  if (!COMMIT_PATTERN.test(targetCommit)) {
    throw new Error("commit must be a 4-40 character hexadecimal object name");
  }
  const detected = await detectRepo(deps);
  if (!detected.available) throw new Error("git is not available for this workspace (reason: " + String(detected.error) + ")");
  const repoRelative = repoPathFor(detected, normalizedFile);
  if (repoRelative === null || repoRelative === "") {
    throw new Error("file " + JSON.stringify(normalizedFile) + " is outside the git repository");
  }
  const absolute = join3(deps.sourceRoot, ...normalizedFile.split("/"));
  const resolved = await realpathWithinRoot(deps.sourceRoot, absolute);
  if (resolved === null) throw new Error("file " + JSON.stringify(normalizedFile) + " escapes the source root");
  try {
    await runGit(detected.repoRoot, ["cat-file", "-e", targetCommit + ":" + repoRelative], { readOnly: true });
  } catch {
    throw new Error("file " + JSON.stringify(normalizedFile) + " does not exist in commit " + targetCommit);
  }
  await runGit(detected.repoRoot, ["checkout", targetCommit, "--", repoRelative]);
  return { ok: true, file: normalizedFile, commit: targetCommit, status: "restored" };
}
async function gitCommit(deps, message, files) {
  if (typeof message !== "string" || message.trim() === "") {
    throw new Error("a commit message is required");
  }
  const text = message.trim().slice(0, COMMIT_MESSAGE_LIMIT);
  if (files !== void 0 && files !== null && !Array.isArray(files)) {
    throw new Error("files must be an array of sourceRoot-relative paths");
  }
  const detected = await detectRepo(deps);
  if (!detected.available) throw new Error("git is not available for this workspace (reason: " + String(detected.error) + ")");
  const repoRoot = detected.repoRoot;
  const before = await readGitState(deps);
  const selected = [];
  if (Array.isArray(files) && files.length > 0) {
    const known = new Set(before.changes.map((change) => change.path));
    const seen = /* @__PURE__ */ new Set();
    for (const entry of files) {
      const normalizedFile = normalizeRelativePath(entry, "file");
      if (seen.has(normalizedFile)) continue;
      seen.add(normalizedFile);
      if (!known.has(normalizedFile)) {
        throw new Error("refusing to commit a path with no pending change: " + JSON.stringify(normalizedFile));
      }
      const repoRelative = repoPathFor(detected, normalizedFile);
      if (repoRelative === null || repoRelative === "") {
        throw new Error("path " + JSON.stringify(normalizedFile) + " is outside the git repository");
      }
      const absolute = join3(deps.sourceRoot, ...normalizedFile.split("/"));
      const resolved = await realpathWithinRoot(deps.sourceRoot, absolute);
      if (resolved === null) throw new Error("path " + JSON.stringify(normalizedFile) + " escapes the source root");
      selected.push(repoRelative);
    }
    if (selected.length > 0) await runGit(repoRoot, ["add", "--", ...selected]);
  } else {
    await runGit(repoRoot, ["add", "-A"]);
  }
  const staged = await runGit(repoRoot, ["diff", "--cached", "--name-only", "-z"], { readOnly: true });
  if (staged.stdout.replace(/\u0000/g, "").trim() === "") {
    return { ok: true, committed: false, reason: "nothing-to-commit", git: await readGitState(deps) };
  }
  try {
    await runGit(repoRoot, ["commit", "-m", text]);
  } catch (error) {
    throw new Error("git commit failed: " + failureText(error));
  }
  const hash = (await runGit(repoRoot, ["rev-parse", "HEAD"], { readOnly: true })).stdout.trim();
  const short = (await runGit(repoRoot, ["rev-parse", "--short", "HEAD"], { readOnly: true })).stdout.trim();
  const subject = (await runGit(repoRoot, ["log", "-1", "--format=%s"], { readOnly: true })).stdout.trim();
  return {
    ok: true,
    committed: true,
    commit: { hash, short, subject },
    git: await readGitState(deps)
  };
}

// src/host/domains/workspace/preview.ts
import { watch } from "node:fs";
import { readdir as readdir2, readFile, realpath as realpath3, stat as stat2 } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join as join4 } from "node:path";
var WATCH_DEBOUNCE_MS = 120;
var WATCH_RECENT_LIMIT = 8;
var POLL_INTERVAL_MS = 1e3;
var POLL_MAX_ENTRIES = 2e3;
var POLL_MAX_DEPTH = 10;
var MIME_TYPES = /* @__PURE__ */ new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".cjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".eot", "application/vnd.ms-fontobject"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".pdf", "application/pdf"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"]
]);
function mimeFor(absolutePath) {
  const extension = extname(absolutePath).toLowerCase();
  return MIME_TYPES.get(extension) ?? "application/octet-stream";
}
function encodeRelativeUrlPath(relativePath) {
  return relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
function sendText(response, status, text, headOnly, extraHeaders) {
  const body = Buffer.from(String(text), "utf8");
  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders || {}
  };
  response.writeHead(status, headers);
  if (headOnly) response.end();
  else response.end(body);
}
function isForbiddenRequestSegment(segment) {
  if (segment === ".." || segment === ".") return true;
  if (segment.startsWith(".")) return true;
  return segment.toLowerCase() === "node_modules";
}
async function statSafe(absolutePath) {
  try {
    return await stat2(absolutePath);
  } catch {
    return void 0;
  }
}
function createPreviewServer(rootReal) {
  async function handle(request, response) {
    const headOnly = String(request.method || "GET").toUpperCase() === "HEAD";
    try {
      const method = String(request.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        sendText(response, 405, "method not allowed", false, { allow: "GET, HEAD" });
        return;
      }
      let pathname;
      try {
        const rawUrl = String(request.url || "/");
        const queryIndex = rawUrl.indexOf("?");
        pathname = decodeURIComponent(queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl);
      } catch {
        sendText(response, 400, "bad request", headOnly);
        return;
      }
      if (pathname.includes("\0")) {
        sendText(response, 400, "bad request", headOnly);
        return;
      }
      const segments = pathname.split("/").filter((segment) => segment.length > 0);
      for (const segment of segments) {
        if (isForbiddenRequestSegment(segment)) {
          sendText(response, 403, "forbidden", headOnly);
          return;
        }
      }
      let absolutePath = segments.length === 0 ? join4(rootReal, "index.html") : join4(rootReal, ...segments);
      let info = await statSafe(absolutePath);
      if (info !== void 0 && info.isDirectory()) {
        absolutePath = join4(absolutePath, "index.html");
        info = await statSafe(absolutePath);
      }
      if (info === void 0 || !info.isFile()) {
        sendText(response, 404, "not found", headOnly);
        return;
      }
      let resolved;
      try {
        resolved = await realpath3(absolutePath);
      } catch {
        sendText(response, 404, "not found", headOnly);
        return;
      }
      if (!isInsideOrEqual(rootReal, resolved)) {
        sendText(response, 403, "forbidden", headOnly);
        return;
      }
      const content = await readFile(resolved);
      response.writeHead(200, {
        "content-type": mimeFor(resolved),
        "content-length": String(content.length),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      if (headOnly) response.end();
      else response.end(content);
    } catch {
      if (!response.headersSent) sendText(response, 500, "internal error", headOnly);
      else response.destroy();
    }
  }
  return createServer((request, response) => {
    void handle(request, response);
  });
}
function closeServer(entry) {
  return new Promise((resolve) => {
    const server = entry.server;
    try {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    } catch {
    }
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}
async function startServer(rootReal) {
  const server = createPreviewServer(rootReal);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(void 0);
    });
  });
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;
  return { server, port, baseUrl: "http://127.0.0.1:" + port + "/" };
}
function createPreviewService() {
  const entries = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Map();
  async function ensure(root) {
    const existing = entries.get(root);
    if (existing !== void 0) return existing;
    const inflight = pending.get(root);
    if (inflight !== void 0) return inflight;
    const promise = startServer(root).then((entry) => {
      entries.set(root, entry);
      pending.delete(root);
      return entry;
    }).catch((error) => {
      pending.delete(root);
      throw error;
    });
    pending.set(root, promise);
    return promise;
  }
  return {
    /** Synchronous snapshot for the `workspace()` payload. */
    peek(root) {
      const entry = entries.get(root);
      if (entry === void 0) return { active: false, port: 0, baseUrl: "" };
      return { active: true, port: entry.port, baseUrl: entry.baseUrl };
    },
    /** §3.6 — start or reuse the server and build a webview URL. */
    async open(root, file) {
      if (file !== void 0 && file !== null && typeof file !== "string") {
        throw new Error("file must be a string path");
      }
      let relativeFile = "";
      if (file !== void 0 && file !== null && String(file).trim() !== "") {
        relativeFile = normalizeRelativePath(String(file), "file");
        for (const segment of relativeFile.split("/")) {
          if (isForbiddenRequestSegment(segment)) {
            throw new Error("file " + JSON.stringify(relativeFile) + " cannot be served");
          }
        }
      }
      const entry = await ensure(root);
      const url = relativeFile ? entry.baseUrl + encodeRelativeUrlPath(relativeFile) : entry.baseUrl;
      return {
        ok: true,
        port: entry.port,
        baseUrl: entry.baseUrl,
        url,
        file: relativeFile,
        root
      };
    },
    /** §3.7 — close the server for one root (idempotent). */
    async stop(root) {
      const entry = entries.get(root);
      if (entry !== void 0) {
        entries.delete(root);
        await closeServer(entry);
      }
      const inflight = pending.get(root);
      if (inflight !== void 0) {
        pending.delete(root);
        try {
          await closeServer(await inflight);
        } catch {
        }
      }
      return { ok: true, root };
    },
    async dispose() {
      const roots = [...entries.keys()];
      for (const root of roots) {
        const entry = entries.get(root);
        entries.delete(root);
        if (entry !== void 0) await closeServer(entry);
      }
      for (const [, promise] of pending) {
        try {
          await closeServer(await promise);
        } catch {
        }
      }
      pending.clear();
    }
  };
}
async function boundedSnapshot(root) {
  const snapshot = /* @__PURE__ */ new Map();
  let count = 0;
  async function walk(absoluteDir, relativeDir, depth) {
    if (count >= POLL_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir2(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= POLL_MAX_ENTRIES) return;
      if (isIgnoredName(entry.name)) continue;
      const relativePath = relativeDir ? relativeDir + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (depth < POLL_MAX_DEPTH) await walk(join4(absoluteDir, entry.name), relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      try {
        const info = await stat2(join4(absoluteDir, entry.name));
        snapshot.set(relativePath, String(info.mtimeMs) + ":" + String(info.size));
      } catch {
      }
    }
  }
  await walk(root, "", 0);
  return snapshot;
}
function diffSnapshots(previous, next) {
  const changed = [];
  for (const [path, version] of next) {
    if (previous.get(path) !== version) changed.push(path);
  }
  for (const path of previous.keys()) {
    if (!next.has(path)) changed.push(path);
  }
  return changed;
}
function createWatcherService() {
  const states = /* @__PURE__ */ new Map();
  function record(state, paths) {
    const names = Array.from(new Set(paths.filter((path) => typeof path === "string" && path.length > 0)));
    if (names.length === 0 && !state.dirtyFlag) return;
    state.dirtyFlag = false;
    state.revision += 1;
    const at = Date.now();
    for (const path of names) state.changed.push({ path, at });
    if (state.changed.length > WATCH_RECENT_LIMIT) {
      state.changed = state.changed.slice(state.changed.length - WATCH_RECENT_LIMIT);
    }
  }
  function scheduleFlush(state) {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      const pending = Array.from(state.pending);
      state.pending.clear();
      record(state, pending);
    }, WATCH_DEBOUNCE_MS);
    if (typeof state.timer.unref === "function") state.timer.unref();
  }
  function queueChange(state, relativePath) {
    const name = String(relativePath || "").split("\\").join("/");
    state.dirtyFlag = true;
    if (name.length === 0) {
      scheduleFlush(state);
      return;
    }
    if (isIgnoredName(name.split("/")[0])) return;
    if (name.split("/").some((segment) => isIgnoredName(segment))) return;
    state.pending.add(name);
    scheduleFlush(state);
  }
  function startPolling(state) {
    if (state.pollTimer !== null) return;
    state.watching = true;
    state.pollTimer = setInterval(() => {
      if (state.polling) return;
      state.polling = true;
      void boundedSnapshot(state.root).then((snapshot) => {
        if (state.snapshot !== null) {
          const changed = diffSnapshots(state.snapshot, snapshot);
          if (changed.length > 0) record(state, changed);
        }
        state.snapshot = snapshot;
      }).catch(() => {
      }).finally(() => {
        state.polling = false;
      });
    }, POLL_INTERVAL_MS);
    if (typeof state.pollTimer.unref === "function") state.pollTimer.unref();
    void boundedSnapshot(state.root).then((snapshot) => {
      if (state.snapshot === null) state.snapshot = snapshot;
    }).catch(() => {
    });
  }
  function startWatching(state) {
    try {
      const watcher = watch(state.root, { recursive: true }, (_eventType, filename) => {
        queueChange(state, typeof filename === "string" ? filename : "");
      });
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
        }
        if (state.watcher === watcher) state.watcher = null;
        startPolling(state);
      });
      state.watcher = watcher;
      state.watching = true;
    } catch {
      state.watcher = null;
      startPolling(state);
    }
  }
  function stopState(state) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.pollTimer !== null) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.watcher !== null) {
      try {
        state.watcher.close();
      } catch {
      }
      state.watcher = null;
    }
    state.watching = false;
    state.pending.clear();
  }
  function ensure(root) {
    const existing = states.get(root);
    if (existing !== void 0) return existing;
    const state = {
      root,
      revision: 0,
      changed: [],
      pending: /* @__PURE__ */ new Set(),
      dirtyFlag: false,
      timer: null,
      watcher: null,
      pollTimer: null,
      snapshot: null,
      polling: false,
      watching: false
    };
    states.set(root, state);
    startWatching(state);
    return state;
  }
  return {
    /** §3.8 — start (or reuse) the watcher and report its current state. */
    poll(root) {
      const state = ensure(root);
      return {
        revision: state.revision,
        root,
        watching: state.watching,
        changed: state.changed.map((entry) => ({ path: entry.path, at: entry.at }))
      };
    },
    stop(root) {
      const state = states.get(root);
      if (state === void 0) return;
      states.delete(root);
      stopState(state);
    },
    dispose() {
      for (const state of states.values()) stopState(state);
      states.clear();
    }
  };
}

// src/host/domains/workspace/index.ts
var DEFAULT_MAX_SCAN_FILES2 = 400;
function createWorkspaceDomain(deps) {
  const config = deps.config && typeof deps.config === "object" ? deps.config : {};
  const maxScanFiles = typeof config.maxScanFiles === "number" && Number.isFinite(config.maxScanFiles) && config.maxScanFiles > 0 ? Math.floor(config.maxScanFiles) : DEFAULT_MAX_SCAN_FILES2;
  const preview = createPreviewService();
  const watcher = createWatcherService();
  async function contextFor(sessionId) {
    const session = deps.requireSession(sessionId);
    const cwd = deps.sessionCwd(session);
    if (typeof cwd !== "string" || cwd.length === 0) {
      throw new Error("this session has no working directory");
    }
    const policy = deps.sessionPolicy(session);
    const root = await deps.resolveSourceRoot(session, cwd);
    return { cwd, sourceRoot: root.root, policy };
  }
  function requireWritable(policy, action) {
    if (policy !== null && typeof policy === "object" && policy.mode === "read-only") {
      throw new Error("the current session policy is read-only and does not allow " + action);
    }
  }
  return {
    /** §3.1 — workspace snapshot: policy, git facts, HTML scan, preview state. */
    async workspace(sessionId) {
      const context = await contextFor(sessionId);
      const git = await readGitState(context);
      const scan = await scanHtmlFiles({ sourceRoot: context.sourceRoot, maxScanFiles });
      const labels = /* @__PURE__ */ new Map();
      for (const change of git.changes) labels.set(change.path, change.label);
      const htmlFiles = scan.files.map((file) => ({
        ...file,
        change: labels.has(file.path) ? labels.get(file.path) : null
      }));
      return {
        sessionId,
        cwd: context.cwd,
        sourceRoot: context.sourceRoot,
        writable: context.policy.mode !== "read-only",
        truncated: scan.truncated,
        git,
        htmlFiles,
        preview: preview.peek(context.sourceRoot)
      };
    },
    /** §3.2 — recent commits (read operation, no policy gate). */
    async gitLog(sessionId, file) {
      const context = await contextFor(sessionId);
      return gitLog(context, file);
    },
    /** §3.3 — switch branches; dirty refusal / stash mode. */
    async gitSwitch(sessionId, branch, options) {
      const context = await contextFor(sessionId);
      requireWritable(context.policy, "switching branches");
      return gitSwitch(context, branch, options);
    },
    /** §3.4 — restore one file from a commit. */
    async gitRestoreFile(sessionId, file, commit) {
      const context = await contextFor(sessionId);
      requireWritable(context.policy, "restoring files");
      return gitRestoreFile(context, file, commit);
    },
    /** §3.5 — commit selected files or everything. */
    async gitCommit(sessionId, message, files) {
      const context = await contextFor(sessionId);
      requireWritable(context.policy, "committing changes");
      return gitCommit(context, message, files);
    },
    /** §3.6 — start or reuse the static server for this sourceRoot. */
    async previewOpen(sessionId, file) {
      const context = await contextFor(sessionId);
      return preview.open(context.sourceRoot, file);
    },
    /** §3.7 — stop the static server and watcher for this sourceRoot. */
    async previewStop(sessionId) {
      const context = await contextFor(sessionId);
      watcher.stop(context.sourceRoot);
      return preview.stop(context.sourceRoot);
    },
    /** §3.8 — start (or reuse) the watcher and report revision/state. */
    async watchPoll(sessionId) {
      const context = await contextFor(sessionId);
      return watcher.poll(context.sourceRoot);
    },
    /** Host-side teardown registered through `ctx.effect`. */
    async dispose() {
      watcher.dispose();
      await preview.dispose();
    }
  };
}
export {
  createWorkspaceDomain
};
