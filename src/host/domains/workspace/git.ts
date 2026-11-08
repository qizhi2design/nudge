// @ts-nocheck
/**
 * dsh.nudge — host workspace domain: git repository state and write operations.
 *
 * Contract: docs/workspace-versions.md §2–§3.5.
 *
 * Rules enforced here:
 *  - every git command goes through `execFile('git', args, …)` — never a shell;
 *  - the repository must live at or inside the session cwd, and must overlap
 *    `sourceRoot` in one of three documented ways:
 *      repoRoot === sourceRoot  → relativeRoot='', sourceSubdir=''
 *      repoRoot inside sourceRoot → relativeRoot = repo/source, sourceSubdir=''
 *      sourceRoot inside repoRoot → relativeRoot='', sourceSubdir = source/repo
 *    disjoint roots report `available=false`, `error='outside-workspace'`;
 *  - every API path is relative to `sourceRoot`; the helpers below convert to
 *    and from repository-relative paths through `relativeRoot`/`sourceSubdir`;
 *  - `git.changes` is filtered to sourceRoot members (and paths stripped);
 *    `gitCommit` with explicit `files` uses the same mapping, while the
 *    omitted-`files` form stays a repository-wide `git add -A` (per contract);
 *  - branch names come from the local `refs/heads` whitelist and commits must
 *    match /^[0-9a-fA-F]{4,40}$/;
 *  - file paths are validated by the shared path helpers and resolved through
 *    `realpath` before any write reaches the filesystem.
 *
 * Stable failure reasons returned (never thrown) by gitSwitch:
 *   'dirty' | 'switch-failed'.
 * Expected states returned by gitCommit: { committed: false,
 * reason: 'nothing-to-commit' }.
 *
 * No top-level side effects.
 */

import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  isInsideOrEqual,
  normalizeRelativePath,
  realpathWithinRoot,
  relativePosix,
} from './paths.js'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 20_000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const LOG_LIMIT = 40
const COMMIT_MESSAGE_LIMIT = 4000
const FAILURE_TEXT_LIMIT = 800

const COMMIT_PATTERN = /^[0-9a-fA-F]{4,40}$/

class GitCommandError extends Error {
  constructor(message, facts) {
    super(message)
    this.name = 'GitCommandError'
    this.exitCode = facts.exitCode
    this.stdout = facts.stdout
    this.stderr = facts.stderr
    this.spawnCode = facts.spawnCode
  }
}

function firstLine(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.length > 0 ? lines[0] : ''
}

/** Run one git command; throws a GitCommandError carrying stdout/stderr. */
async function runGit(cwd, args, options = {}) {
  const readOnly = options.readOnly === true
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  if (readOnly) env.GIT_OPTIONAL_LOCKS = '0'
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: 'utf8',
      windowsHide: true,
      env,
    })
    return { stdout: String(result.stdout), stderr: String(result.stderr) }
  } catch (error) {
    const spawnCode = typeof error?.code === 'string' ? error.code : undefined
    const exitCode = typeof error?.code === 'number' ? error.code : null
    const stdout = typeof error?.stdout === 'string' ? error.stdout : ''
    const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
    let message
    if (spawnCode === 'ENOENT') {
      message = 'git is not available on this machine'
    } else {
      const detail = firstLine(stderr) || firstLine(stdout) || String(error?.message || 'unknown git failure')
      message = 'git ' + String(args[0] || '') + ' failed: ' + detail
    }
    throw new GitCommandError(message, { spawnCode, exitCode, stdout, stderr })
  }
}

/** Compact stderr/stdout excerpt for remote error messages (hooks included). */
function failureText(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
  let text = stderr || stdout || (error instanceof Error ? error.message : String(error))
  if (text.length > FAILURE_TEXT_LIMIT) text = text.slice(0, FAILURE_TEXT_LIMIT) + '…'
  return text
}

function unavailableGit(error) {
  return {
    available: false,
    repoRoot: '',
    relativeRoot: '',
    sourceSubdir: '',
    branch: '',
    detached: false,
    branches: [],
    clean: true,
    changes: [],
    error,
  }
}

/**
 * SourceRoot-relative API path -> repo-root-relative path, or null when the
 * path is outside the repository.
 *
 * `relativeRoot` case: the repo root lives inside sourceRoot, so API paths are
 * prefixed by `relativeRoot` and that prefix is stripped here.
 * `sourceSubdir` case: sourceRoot lives inside the repo, so the sub directory
 * prefix is prepended here.
 */
export function repoPathFor(mapping, sourcePath) {
  if (mapping.sourceSubdir) return mapping.sourceSubdir + '/' + sourcePath
  if (mapping.relativeRoot) {
    const prefix = mapping.relativeRoot + '/'
    return sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : null
  }
  return sourcePath
}

/**
 * Repo-root-relative path -> sourceRoot-relative API path, or null when the
 * repository path is outside sourceRoot (filtered out of `git.changes`).
 */
export function sourcePathFor(mapping, repoPath) {
  if (mapping.sourceSubdir) {
    const prefix = mapping.sourceSubdir + '/'
    return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null
  }
  if (mapping.relativeRoot) return mapping.relativeRoot + '/' + repoPath
  return repoPath
}

async function probeRepoRoot(startDir) {
  try {
    const result = await runGit(startDir, ['rev-parse', '--show-toplevel'], { readOnly: true })
    const top = result.stdout.trim()
    if (!top) return { ok: false, reason: 'not-a-repository' }
    return { ok: true, repoRoot: await realpath(top) }
  } catch (error) {
    return { ok: false, reason: error?.spawnCode === 'ENOENT' ? 'git-unavailable' : 'not-a-repository' }
  }
}

/** Apply the cwd and sourceRoot overlap rules to one candidate repository. */
function classifyOverlap(cwdReal, sourceReal, repoRoot) {
  // Rule (a): only repositories at or inside the session cwd are operated on.
  if (!isInsideOrEqual(cwdReal, repoRoot)) {
    return { available: false, error: 'outside-workspace' }
  }
  // Rule (b): repoRoot and sourceRoot must overlap in one of three ways.
  if (repoRoot === sourceReal) {
    return { available: true, relativeRoot: '', sourceSubdir: '' }
  }
  if (isInsideOrEqual(repoRoot, sourceReal)) {
    // sourceRoot is a subdirectory of the repository (the common case).
    return { available: true, relativeRoot: '', sourceSubdir: relativePosix(repoRoot, sourceReal) ?? '' }
  }
  if (isInsideOrEqual(sourceReal, repoRoot)) {
    // A nested repository lives inside sourceRoot.
    return { available: true, relativeRoot: relativePosix(sourceReal, repoRoot) ?? '', sourceSubdir: '' }
  }
  return { available: false, error: 'outside-workspace' }
}

/**
 * Detect the repository that owns the session cwd and overlaps sourceRoot.
 * The probe starts at sourceRoot (nearest repository wins, so a nested repo
 * directly at sourceRoot beats an enclosing cwd repository), then falls back
 * to cwd.
 * @returns {Promise<{available: boolean, repoRoot: string, relativeRoot: string, sourceSubdir: string, error: string|null}>}
 */
export async function detectRepo({ cwd, sourceRoot }) {
  let cwdReal
  let sourceReal
  try {
    cwdReal = await realpath(cwd)
    sourceReal = await realpath(sourceRoot)
  } catch {
    return { available: false, repoRoot: '', relativeRoot: '', sourceSubdir: '', error: 'workspace-unavailable' }
  }
  const starts = [sourceReal]
  if (cwdReal !== sourceReal) starts.push(cwdReal)
  const seen = new Set()
  for (const start of starts) {
    const probe = await probeRepoRoot(start)
    if (!probe.ok) {
      seen.add(probe.reason)
      continue
    }
    const overlap = classifyOverlap(cwdReal, sourceReal, probe.repoRoot)
    if (overlap.available) {
      return {
        available: true,
        repoRoot: probe.repoRoot,
        relativeRoot: overlap.relativeRoot,
        sourceSubdir: overlap.sourceSubdir,
        error: null,
      }
    }
    seen.add(overlap.error)
  }
  const reason = seen.has('outside-workspace')
    ? 'outside-workspace'
    : seen.has('git-unavailable')
      ? 'git-unavailable'
      : 'not-a-repository'
  return { available: false, repoRoot: '', relativeRoot: '', sourceSubdir: '', error: reason }
}

async function readBranch(repoRoot) {
  try {
    const result = await runGit(repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD'], { readOnly: true })
    const branch = result.stdout.trim()
    if (branch) return { branch, detached: false }
  } catch {
    /* detached HEAD or an unborn branch */
  }
  return { branch: '', detached: true }
}

async function readBranches(repoRoot, currentBranch) {
  let output = ''
  try {
    const result = await runGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
      readOnly: true,
    })
    output = result.stdout
  } catch {
    return []
  }
  const names = output
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  names.sort((a, b) => a.localeCompare(b))
  return names.map((name) => ({ name, current: name === currentBranch }))
}

/** Map a porcelain XY pair to one of the contract labels. */
function labelFor(indexCode, worktreeCode) {
  const pair = indexCode + worktreeCode
  if (indexCode === 'U' || worktreeCode === 'U' || pair === 'AA' || pair === 'DD') return 'conflicted'
  if (indexCode === '?' || worktreeCode === '?') return 'untracked'
  if (indexCode === 'R' || worktreeCode === 'R') return 'renamed'
  if (indexCode === 'D' || worktreeCode === 'D') return 'deleted'
  if (indexCode === 'A' || worktreeCode === 'A' || indexCode === 'C' || worktreeCode === 'C') return 'added'
  return 'modified'
}

/**
 * Parse `git status --porcelain=v1 -z`, keep only entries inside sourceRoot and
 * convert their paths to sourceRoot-relative API paths.
 */
async function readChanges(detected) {
  const result = await runGit(
    detected.repoRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { readOnly: true },
  )
  const tokens = result.stdout.split('\u0000')
  const changes = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token || token.length < 4) continue
    const indexCode = token[0]
    const worktreeCode = token[1]
    const repoPath = token.slice(3)
    if (!repoPath) continue
    let fromPath
    if (indexCode === 'R' || indexCode === 'C' || worktreeCode === 'R' || worktreeCode === 'C') {
      const from = tokens[index + 1]
      if (from) {
        fromPath = from
        index += 1
      }
    }
    const path = sourcePathFor(detected, repoPath)
    if (path === null || path === '') continue
    const change = {
      path,
      index: indexCode,
      worktree: worktreeCode,
      label: labelFor(indexCode, worktreeCode),
    }
    const fromRelative = fromPath === undefined ? null : sourcePathFor(detected, fromPath)
    if (fromRelative) change.from = fromRelative
    changes.push(change)
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return changes
}

/** Full git state in the shape documented at §3.1. */
export async function readGitState({ cwd, sourceRoot }) {
  const detected = await detectRepo({ cwd, sourceRoot })
  if (!detected.available) return unavailableGit(detected.error)
  const repoRoot = detected.repoRoot
  const { branch, detached } = await readBranch(repoRoot)
  const branches = await readBranches(repoRoot, branch)
  const changes = await readChanges(detected)
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
    error: null,
  }
}

/**
 * §3.2 — recent commits, optionally scoped to one sourceRoot-relative file.
 * Read-only: no policy gate.
 */
export async function gitLog(deps, file) {
  if (file !== undefined && file !== null && typeof file !== 'string') {
    throw new Error('file must be a string path')
  }
  const normalizedFile =
    typeof file === 'string' && file.trim() !== '' ? normalizeRelativePath(file, 'file') : ''
  const detected = await detectRepo(deps)
  if (!detected.available) return { file: normalizedFile, commits: [] }
  const args = [
    'log',
    '--max-count=' + LOG_LIMIT,
    '--date=iso-strict',
    '--format=%H%x00%h%x00%an%x00%aI%x00%s',
  ]
  if (normalizedFile) {
    const repoRelative = repoPathFor(detected, normalizedFile)
    if (repoRelative === null || repoRelative === '') return { file: normalizedFile, commits: [] }
    args.push('--', repoRelative)
  }
  let output
  try {
    const result = await runGit(detected.repoRoot, args, { readOnly: true })
    output = result.stdout
  } catch (error) {
    // An empty repository has no HEAD yet; report an empty history rather than
    // failing the read-only panel.
    const detail = String(error?.stderr || '') + String(error?.stdout || '') + String(error?.message || '')
    if (/does not have any commits|unknown revision|bad revision/i.test(detail)) {
      return { file: normalizedFile, commits: [] }
    }
    throw error
  }
  const commits = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const fields = line.split('\u0000')
    if (fields.length < 5) continue
    commits.push({
      hash: fields[0],
      short: fields[1],
      author: fields[2],
      date: fields[3],
      subject: fields[4],
    })
  }
  return { file: normalizedFile, commits }
}

/** §3.3 — switch branches; dirty trees are refused unless `options.stash`. */
export async function gitSwitch(deps, branch, options) {
  if (typeof branch !== 'string' || branch.trim() === '') throw new Error('a branch name is required')
  const target = branch.trim()
  const detected = await detectRepo(deps)
  if (!detected.available) throw new Error('git is not available for this workspace (reason: ' + String(detected.error) + ')')
  const repoRoot = detected.repoRoot
  const branches = await readBranches(repoRoot, '')
  if (!branches.some((entry) => entry.name === target)) {
    throw new Error('unknown local branch ' + JSON.stringify(target))
  }
  const before = await readGitState(deps)
  if (!before.detached && before.branch === target) {
    return { ok: true, branch: target, stashed: false, clean: before.clean, git: before }
  }
  const stashWanted = options !== null && typeof options === 'object' && options.stash === true
  const dirty = !before.clean
  if (dirty && !stashWanted) return { ok: false, reason: 'dirty', git: before }

  let stashed = false
  if (dirty) {
    try {
      await runGit(repoRoot, ['stash', 'push', '--include-untracked', '-m', 'dsh-nudge: switch to ' + target])
      stashed = true
    } catch (error) {
      return {
        ok: false,
        reason: 'switch-failed',
        message: 'could not stash the working tree: ' + failureText(error),
        git: before,
      }
    }
  }

  try {
    await runGit(repoRoot, ['switch', target])
  } catch (error) {
    let note = ''
    if (stashed) {
      try {
        await runGit(repoRoot, ['stash', 'pop'])
        note = '; the stashed changes were restored'
      } catch (restoreError) {
        note = '; the stashed changes could not be restored: ' + failureText(restoreError)
      }
    }
    const after = await readGitState(deps)
    return {
      ok: false,
      reason: 'switch-failed',
      message: failureText(error) + note,
      git: after,
    }
  }

  const after = await readGitState(deps)
  return { ok: true, branch: target, stashed, clean: after.clean, git: after }
}

/** §3.4 — restore one file from a commit (worktree + index only). */
export async function gitRestoreFile(deps, file, commit) {
  const normalizedFile = normalizeRelativePath(file, 'file')
  const targetCommit = String(commit ?? '').trim()
  if (!COMMIT_PATTERN.test(targetCommit)) {
    throw new Error('commit must be a 4-40 character hexadecimal object name')
  }
  const detected = await detectRepo(deps)
  if (!detected.available) throw new Error('git is not available for this workspace (reason: ' + String(detected.error) + ')')
  const repoRelative = repoPathFor(detected, normalizedFile)
  if (repoRelative === null || repoRelative === '') {
    throw new Error('file ' + JSON.stringify(normalizedFile) + ' is outside the git repository')
  }
  const absolute = join(deps.sourceRoot, ...normalizedFile.split('/'))
  const resolved = await realpathWithinRoot(deps.sourceRoot, absolute)
  if (resolved === null) throw new Error('file ' + JSON.stringify(normalizedFile) + ' escapes the source root')
  try {
    await runGit(detected.repoRoot, ['cat-file', '-e', targetCommit + ':' + repoRelative], { readOnly: true })
  } catch {
    throw new Error('file ' + JSON.stringify(normalizedFile) + ' does not exist in commit ' + targetCommit)
  }
  await runGit(detected.repoRoot, ['checkout', targetCommit, '--', repoRelative])
  return { ok: true, file: normalizedFile, commit: targetCommit, status: 'restored' }
}

/** §3.5 — add (selected sourceRoot paths or everything) and commit. */
export async function gitCommit(deps, message, files) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new Error('a commit message is required')
  }
  const text = message.trim().slice(0, COMMIT_MESSAGE_LIMIT)
  if (files !== undefined && files !== null && !Array.isArray(files)) {
    throw new Error('files must be an array of sourceRoot-relative paths')
  }
  const detected = await detectRepo(deps)
  if (!detected.available) throw new Error('git is not available for this workspace (reason: ' + String(detected.error) + ')')
  const repoRoot = detected.repoRoot
  const before = await readGitState(deps)
  const selected = []
  if (Array.isArray(files) && files.length > 0) {
    const known = new Set(before.changes.map((change) => change.path))
    const seen = new Set()
    for (const entry of files) {
      const normalizedFile = normalizeRelativePath(entry, 'file')
      if (seen.has(normalizedFile)) continue
      seen.add(normalizedFile)
      if (!known.has(normalizedFile)) {
        throw new Error('refusing to commit a path with no pending change: ' + JSON.stringify(normalizedFile))
      }
      const repoRelative = repoPathFor(detected, normalizedFile)
      if (repoRelative === null || repoRelative === '') {
        throw new Error('path ' + JSON.stringify(normalizedFile) + ' is outside the git repository')
      }
      const absolute = join(deps.sourceRoot, ...normalizedFile.split('/'))
      const resolved = await realpathWithinRoot(deps.sourceRoot, absolute)
      if (resolved === null) throw new Error('path ' + JSON.stringify(normalizedFile) + ' escapes the source root')
      selected.push(repoRelative)
    }
    if (selected.length > 0) await runGit(repoRoot, ['add', '--', ...selected])
  } else {
    // Contract: omitted `files` stays a repository-wide add, not sourceRoot-only.
    await runGit(repoRoot, ['add', '-A'])
  }
  const staged = await runGit(repoRoot, ['diff', '--cached', '--name-only', '-z'], { readOnly: true })
  if (staged.stdout.replace(/\u0000/g, '').trim() === '') {
    return { ok: true, committed: false, reason: 'nothing-to-commit', git: await readGitState(deps) }
  }
  try {
    await runGit(repoRoot, ['commit', '-m', text])
  } catch (error) {
    throw new Error('git commit failed: ' + failureText(error))
  }
  const hash = (await runGit(repoRoot, ['rev-parse', 'HEAD'], { readOnly: true })).stdout.trim()
  const short = (await runGit(repoRoot, ['rev-parse', '--short', 'HEAD'], { readOnly: true })).stdout.trim()
  const subject = (await runGit(repoRoot, ['log', '-1', '--format=%s'], { readOnly: true })).stdout.trim()
  return {
    ok: true,
    committed: true,
    commit: { hash, short, subject },
    git: await readGitState(deps),
  }
}
