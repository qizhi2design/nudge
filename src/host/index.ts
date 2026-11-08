// @ts-nocheck
/**
 * dsh.nudge — host (Node) half.
 *
 * Owns the sessionless `nudge/*` remote API used by the Client half:
 *
 *  - `session`          resolve the calling session's working directory, the
 *                       effective sandbox policy, and the source-mapping
 *                       defaults;
 *  - `sync`             persist a batch of live visual edits into real
 *                       Workspace source files (best effort, explicitly
 *                       reporting preview-only / failed outcomes);
 *  - `saveScreenshot`   materialise one annotation screenshot under the
 *                       workspace so the agent can read it;
 *  - `ping`             liveness probe for the panel.
 *
 * This plugin is a *user* surface only: it registers no agent tool and its
 * writes are fenced by the session's standing sandbox policy. The UI never
 * claims a source write before this half reports `synced`.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, posix, sep, win32 } from 'node:path'

import { syncEdits } from './source-sync.js'
import { createWorkspaceDomain } from './workspace.js'

/** Cordis plugin name. */
export const name = 'dsh.nudge'

/** Hard dependencies; every optional capability is resolved through ctx.get. */
export const inject = ['fs', 'sessions']

/** Remote namespace advertised on the shared `/api` RPC channel. */
const REMOTE_NAMESPACE = 'nudge'

/** Prefix on every remote failure message so the UI can attribute it. */
const ERROR_PREFIX = 'nudge: '

/** Defaults for the Loader row's config. */
const DEFAULT_CONFIG = Object.freeze({
  sourceRoot: '',
  urlRoot: '',
  maxScanFiles: 400,
  maxFileBytes: 2_000_000,
})

/** One native Schemastery object node is enough for the live Config inspector. */
function nativeConfigNode(type, meta) {
  return { [Symbol.for('schemastery')]: true, type, meta: meta || {} }
}

export const Config = nativeConfigNode('object', {
  default: { ...DEFAULT_CONFIG },
  description: 'dsh.nudge configuration.',
})
Config.dict = {
  sourceRoot: nativeConfigNode('string', {
    default: DEFAULT_CONFIG.sourceRoot,
    description:
      'Directory that page URLs map into. Empty uses the session working directory. A path outside the session workspace is ignored.',
  }),
  urlRoot: nativeConfigNode('string', {
    default: DEFAULT_CONFIG.urlRoot,
    description:
      'URL prefix that maps to sourceRoot (for example http://127.0.0.1:4173/). Empty derives it from the page origin.',
  }),
  maxScanFiles: nativeConfigNode('number', {
    default: DEFAULT_CONFIG.maxScanFiles,
    min: 20,
    max: 5000,
    step: 1,
    description: 'Maximum number of source files inspected when a page URL cannot be mapped directly.',
  }),
  maxFileBytes: nativeConfigNode('number', {
    default: DEFAULT_CONFIG.maxFileBytes,
    min: 16384,
    max: 16000000,
    step: 1,
    description: 'Maximum size of one source file the sync step may read.',
  }),
}

const configStandardSchema = {
  version: 1,
  vendor: 'dsh.nudge',
  validate(value) {
    return { value: normalizeConfig(value) }
  },
}
Config['~standard'] = configStandardSchema

function normalizeConfig(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const text = (candidate, fallback) =>
    typeof candidate === 'string' ? candidate.trim() : fallback
  const number = (candidate, fallback, min, max) => {
    const parsed = typeof candidate === 'number' ? candidate : NaN
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.floor(parsed)))
  }
  return {
    sourceRoot: text(raw.sourceRoot, DEFAULT_CONFIG.sourceRoot),
    urlRoot: text(raw.urlRoot, DEFAULT_CONFIG.urlRoot),
    maxScanFiles: number(raw.maxScanFiles, DEFAULT_CONFIG.maxScanFiles, 20, 5000),
    maxFileBytes: number(raw.maxFileBytes, DEFAULT_CONFIG.maxFileBytes, 16_384, 16_000_000),
  }
}

function reasonOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function remoteError(error) {
  const text = reasonOf(error)
  return new Error(ERROR_PREFIX + text.replace(/^nudge:\s*/, ''))
}

/** PATH flavour helper for the platform that owns a path. */
function pathApiFor(path) {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(path) || path.includes('\\') ? win32 : posix
}

/**
 * Mount the Host half.
 * @param ctx - Cordis context of this Loader row.
 * @param rawConfig - the row config (normalised defensively).
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)

  // ------------------------------------------------------------ session facts

  /** Resolve one live session by id; throws when it is not live here. */
  function requireSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('a session id is required')
    }
    const session = ctx.sessions.get(sessionId)
    if (session === undefined || session === null) {
      throw new Error('session ' + JSON.stringify(sessionId) + ' is not live in this harness process')
    }
    return session
  }

  /** Read the session's effective working directory without I/O. */
  function sessionCwd(session) {
    const wd = ctx.get('workingDirectory')
    if (wd !== undefined && wd !== null && typeof wd.get === 'function') {
      try {
        const value = wd.get(session)
        if (typeof value === 'string' && value.length > 1) return value
      } catch {
        /* fall through to the header */
      }
    }
    const headerCwd = session?.header?.cwd
    if (typeof headerCwd === 'string' && isAbsolute(headerCwd)) return headerCwd
    const sandbox = ctx.get('sandboxPolicy')
    if (sandbox !== undefined && sandbox !== null) {
      try {
        const policy = sandbox.resolve({ session })
        if (typeof policy?.workspaceRoot === 'string') return policy.workspaceRoot
      } catch {
        /* fall through */
      }
    }
    return undefined
  }

  /** Resolve the standing sandbox policy; never widen it. */
  function sessionPolicy(session) {
    const sandbox = ctx.get('sandboxPolicy')
    if (sandbox !== undefined && sandbox !== null && typeof sandbox.resolve === 'function') {
      try {
        const policy = sandbox.resolve({ session })
        return {
          mode: String(policy?.mode ?? 'read-only'),
          workspaceRoot: String(policy?.workspaceRoot ?? sessionCwd(session) ?? ''),
        }
      } catch {
        /* fall through */
      }
    }
    return { mode: 'read-only', workspaceRoot: sessionCwd(session) ?? '' }
  }

  /**
   * The source root: an absolute directory that URL paths map into. It must be
   * the session cwd or a directory inside it; a configured out-of-workspace
   * root is ignored rather than silently widening write access.
   */
  async function resolveSourceRoot(session, cwd) {
    const fs = ctx.fs
    const cwdTarget = await fs.resolve(cwd)
    const candidate = config.sourceRoot === '' ? cwd : config.sourceRoot
    let absolute = candidate
    if (!isAbsolute(absolute)) {
      absolute = pathApiFor(cwd).join(cwd, candidate)
    }
    const target = await fs.resolve(absolute)
    if (!fs.contains(cwdTarget, target)) {
      return { root: cwd, absolute: cwd, configured: false, inside: false }
    }
    const info = await fs.stat(target)
    if (info === undefined || info === null || info.type !== 'directory') {
      return { root: cwd, absolute: cwd, configured: false, inside: false }
    }
    return {
      root: fs.processPath(target),
      absolute: fs.processPath(target),
      configured: config.sourceRoot !== '',
      inside: true,
    }
  }

  // ------------------------------------------------------- workspace domain

  /**
   * Workspace versions ("worktree → page → version → commit"): git inspection,
   * bounded HTML scan, static preview server and change watcher. The eight
   * remote methods below are thin wrappers that only add the `nudge:` error
   * prefix; the session/policy/sourceRoot resolution helpers are shared.
   */
  const workspace = createWorkspaceDomain({
    ctx,
    config,
    requireSession,
    sessionCwd,
    sessionPolicy,
    resolveSourceRoot,
    pathApiFor,
  })

  // Shut down every preview server and watcher when this plugin row unloads.
  ctx.effect(() => () => workspace.dispose())

  // -------------------------------------------------------- settings bridge

  /**
   * The Loader row this plugin was mounted from, plus the profile config
   * editor that owns it. The Settings page edits the same profile patch the
   * `cordis.patch.yml` config table documents, through the same seam DSH's own
   * plugin pages use — so the write is validated and reconciled by the Loader
   * rather than by this plugin.
   */
  function configEditorBinding() {
    const editor = ctx.get('configEditor')
    if (
      editor === undefined ||
      editor === null ||
      typeof editor.entries !== 'function' ||
      typeof editor.edit !== 'function'
    ) {
      return undefined
    }
    let entry
    try {
      entry =
        editor
          .entries()
          .find((row) => row?.options?.id === 'nudge' || row?.options?.name === name) ?? undefined
    } catch {
      entry = undefined
    }
    if (entry === undefined) return undefined
    return { editor, entry }
  }

  /** Config keys the Settings page may write. */
  const CONFIG_FIELDS = ['sourceRoot', 'urlRoot', 'maxScanFiles', 'maxFileBytes']

  /** Project a raw row config layer into the four editable fields. */
  function configLayerOf(entryConfig) {
    const out = {}
    if (entryConfig === null || typeof entryConfig !== 'object') return out
    for (const key of CONFIG_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(entryConfig, key)) out[key] = entryConfig[key]
    }
    return out
  }

  // ------------------------------------------------------------- remote API

  const api = {
    /** Liveness probe used by the panel's connection pill. */
    async ping() {
      return { ok: true, version: '0.1.0' }
    },

    /**
     * Settings page snapshot: the effective config, the schema defaults, and
     * whether this deployment lets a user write it. `overridden` names the
     * fields the profile patch currently pins explicitly.
     */
    async config() {
      try {
        const binding = configEditorBinding()
        const layer = binding === undefined ? {} : configLayerOf(binding.entry.options?.config)
        const values = normalizeConfig({ ...config, ...layer })
        return {
          values,
          defaults: { ...DEFAULT_CONFIG },
          overridden: Object.keys(layer),
          writable: binding !== undefined,
          source: binding === undefined ? 'loader' : 'profile',
        }
      } catch (error) {
        throw remoteError(error)
      }
    },

    /**
     * Persist a partial config patch into the profile layer. Only the four
     * documented fields are accepted; everything else in the patch is ignored
     * so a stale Client cannot resurrect removed or foreign keys.
     */
    async configUpdate(patch) {
      try {
        const binding = configEditorBinding()
        if (binding === undefined) {
          throw new Error('the profile configuration editor is not available in this deployment')
        }
        const input = patch !== null && typeof patch === 'object' ? patch : {}
        const fields = configLayerOf(input)
        if (Object.keys(fields).length === 0) {
          return { values: normalizeConfig({ ...config, ...configLayerOf(binding.entry.options?.config) }), saved: false }
        }
        const next = normalizeConfig({ ...config, ...fields })
        const accepted = {}
        for (const key of Object.keys(fields)) accepted[key] = next[key]
        await binding.editor.edit(binding.entry, (current) => ({
          ...(current !== null && typeof current === 'object' ? current : {}),
          ...accepted,
        }))
        return { values: next, saved: true }
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** Session facts for the panel: cwd, policy, mapping defaults. */
    async session(sessionId) {
      try {
        const session = requireSession(sessionId)
        const cwd = sessionCwd(session)
        if (typeof cwd !== 'string' || cwd.length === 0) {
          throw new Error('this session has no working directory')
        }
        const policy = sessionPolicy(session)
        const root = await resolveSourceRoot(session, cwd)
        const sessionHeader = session.header ?? {}
        return {
          sessionId,
          cwd,
          sourceRoot: root.root,
          sourceRootConfigured: root.configured,
          urlRoot: config.urlRoot,
          policy,
          writable: policy.mode !== 'read-only',
          createdAt: typeof sessionHeader.createdAt === 'number' ? sessionHeader.createdAt : null,
        }
      } catch (error) {
        throw remoteError(error)
      }
    },

    /**
     * Persist one batch of live visual edits.
     * `edits` is an array of plain JSON edit records produced by the page
     * runtime; every result keeps the same `id`.
     */
    async sync(sessionId, page, edits) {
      try {
        const session = requireSession(sessionId)
        const cwd = sessionCwd(session)
        if (typeof cwd !== 'string' || cwd.length === 0) {
          throw new Error('this session has no working directory')
        }
        if (!Array.isArray(edits) || edits.length === 0) {
          return { results: [], syncedAt: Date.now() }
        }
        const policy = sessionPolicy(session)
        const root = await resolveSourceRoot(session, cwd)
        if (policy.mode === 'read-only') {
          return {
            results: edits.map((edit) => ({
              id: String(edit?.id ?? ''),
              status: 'preview',
              reason: 'read-only-policy',
            })),
            syncedAt: Date.now(),
            writable: false,
          }
        }
        const outcome = await syncEdits({
          fs: ctx.fs,
          cwd,
          sourceRoot: root.root,
          urlRoot: config.urlRoot,
          page: page && typeof page === 'object' ? page : {},
          edits,
          policy,
          maxScanFiles: config.maxScanFiles,
          maxFileBytes: config.maxFileBytes,
        })
        return { ...outcome, syncedAt: Date.now(), writable: true }
      } catch (error) {
        throw remoteError(error)
      }
    },

    /**
     * Materialise one annotation screenshot under the workspace so the agent
     * can read it with its normal file tools.
     */
    async saveScreenshot(sessionId, annotationId, dataUrl) {
      try {
        const session = requireSession(sessionId)
        const cwd = sessionCwd(session)
        if (typeof cwd !== 'string' || cwd.length === 0) {
          throw new Error('this session has no working directory')
        }
        if (typeof dataUrl !== 'string') throw new Error('a PNG data URL is required')
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUrl)
        if (match === null) throw new Error('only base64 PNG screenshots are accepted')
        const bytes = Buffer.from(match[1], 'base64')
        if (bytes.length === 0 || bytes.length > 8_000_000) throw new Error('screenshot size is out of range')
        const safeId = String(annotationId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96) || 'shot'
        const policy = sessionPolicy(session)
        if (policy.mode === 'read-only') throw new Error('the current session policy does not allow writing screenshots')
        const directory = pathApiFor(cwd).join(cwd, '.dsh', 'nudge', 'screenshots')
        const directoryTarget = await ctx.fs.resolve(directory)
        const cwdTarget = await ctx.fs.resolve(cwd)
        if (!ctx.fs.contains(cwdTarget, directoryTarget)) throw new Error('screenshot directory is outside the workspace')
        const filePath = pathApiFor(cwd).join(directory, safeId + '-' + Date.now().toString(36) + '.png')
        const fileTarget = await ctx.fs.resolve(filePath)
        if (!ctx.fs.contains(cwdTarget, fileTarget)) throw new Error('screenshot path is outside the workspace')
        await mkdir(directory, { recursive: true })
        await writeFile(filePath, bytes)
        const relative = pathApiFor(cwd).relative(cwd, filePath) || filePath
        return { path: filePath, relativePath: relative.replaceAll(sep, '/') }
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.1 — workspace snapshot: policy, git facts, HTML scan, preview state. */
    async workspace(sessionId) {
      try {
        return await workspace.workspace(sessionId)
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.2 — recent commits, optionally scoped to one file. */
    async gitLog(sessionId, file) {
      try {
        return await workspace.gitLog(sessionId, file)
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.3 — switch branches (dirty refusal, optional stash). */
    async gitSwitch(sessionId, branch, options) {
      try {
        return await workspace.gitSwitch(sessionId, branch, options)
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.4 — restore one file from a commit. */
    async gitRestoreFile(sessionId, file, commit) {
      try {
        return await workspace.gitRestoreFile(sessionId, file, commit)
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.5 — commit selected files or every pending change. */
    async gitCommit(sessionId, message, files) {
      try {
        return await workspace.gitCommit(sessionId, message, files)
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.6 — start (or reuse) the static preview server. */
    async previewOpen(sessionId, file) {
      try {
        return await workspace.previewOpen(sessionId, file)
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.7 — stop the static preview server and watcher. */
    async previewStop(sessionId) {
      try {
        return await workspace.previewStop(sessionId)
      } catch (error) {
        throw remoteError(error)
      }
    },

    /** §3.8 — change-watcher revision poll. */
    async watchPoll(sessionId) {
      try {
        return await workspace.watchPoll(sessionId)
      } catch (error) {
        throw remoteError(error)
      }
    },
  }

  Object.defineProperty(api, 'typertRemote', {
    value: Object.freeze({
      service: api,
      serviceKey: REMOTE_NAMESPACE,
      namespace: REMOTE_NAMESPACE,
    }),
  })

  const remoteParam = (wire) => ({ name: wire, wire, source: 'json', codec: { mode: 'src-json' } })
  const remoteInvocation = (method, params) => ({
    id: 'dsh.nudge#' + REMOTE_NAMESPACE + '/' + method,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters: params.map(remoteParam),
    result: { mode: 'src-json' },
  })

  const REMOTE_CONTRIBUTION = {
    package: 'dsh.nudge',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      remoteInvocation('ping', []),
      remoteInvocation('config', []),
      remoteInvocation('configUpdate', ['patch']),
      remoteInvocation('session', ['session']),
      remoteInvocation('sync', ['session', 'page', 'edits']),
      remoteInvocation('saveScreenshot', ['session', 'annotationId', 'dataUrl']),
      remoteInvocation('workspace', ['session']),
      remoteInvocation('gitLog', ['session', 'file']),
      remoteInvocation('gitSwitch', ['session', 'branch', 'options']),
      remoteInvocation('gitRestoreFile', ['session', 'file', 'commit']),
      remoteInvocation('gitCommit', ['session', 'message', 'files']),
      remoteInvocation('previewOpen', ['session', 'file']),
      remoteInvocation('previewStop', ['session']),
      remoteInvocation('watchPoll', ['session']),
    ],
  }

  ctx.provide(REMOTE_NAMESPACE, api)
  ctx.inject(['typert'], (typertCtx) => typertCtx.typert.register(REMOTE_CONTRIBUTION))
}

/** Exported for the smoke test: the parsed defaults. */
export { DEFAULT_CONFIG, normalizeConfig }
