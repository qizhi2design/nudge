/**
 * Clip-annotation draft store + handoff prompt + send hook.
 *
 * The three pieces live in different files but share one Client factory scope at
 * runtime. This test evaluates them as self-contained *module instances* in one
 * VM context — exactly what a DSH client HMR reload does (tear the old entry
 * fiber down, re-run the bundle factory, apply the new exports) — and then
 * drives the same functions the bundle calls.
 *
 * The extra regression block at the end pins the HMR contract:
 *   - the draft store and the send dispatcher are shared across module instances;
 *   - a stable wrapper installed by an older instance runs the newest dispatcher;
 *   - a pre-fix ("zombie") wrapper is chained once instead of being adopted;
 *   - unload restores only the wrapper the unloading instance owns.
 */
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

let failures = 0
let checks = 0
function assert(condition, name) {
  checks += 1
  if (!condition) {
    failures += 1
    console.error('FAIL - ' + name)
  }
}

const storeSource = await readFile(new URL('../src/client/domains/annotation/clip-store.ts', import.meta.url), 'utf8')
const promptSource = await readFile(new URL('../src/client/platform/prompt.ts', import.meta.url), 'utf8')
const registerSource = await readFile(new URL('../src/client/platform/bootstrap/register.tsx', import.meta.url), 'utf8')

// The slice starts at the diagnostics *bridge state* declarations (before
// `apply`) because the send-hook block reads `clientDebugInstance`; the apply
// function in between is only defined, never called, by the instance harness.
const sendHookStart = registerSource.indexOf('// ---------------------------------------------- client diagnostics bridge state')
const sendHookEnd = registerSource.indexOf('/** Locale dictionaries are embedded at build time by scripts/build-client.mjs. */')
if (sendHookStart < 0 || sendHookEnd < 0) throw new Error('cannot locate the clip send hook block in register.tsx')
const sendHookSource = registerSource.slice(sendHookStart, sendHookEnd)

/** Names one module instance exposes to the checks below. */
const INSTANCE_EXPORTS = [
  // store (clip-store.ts)
  'clipPendingCount',
  'clipPendingSessionIds',
  'insertClips',
  'useClipEntry',
  'updateClipNote',
  'removeClip',
  'removeClipOps',
  'clearClipOps',
  'clearClips',
  'setClipExpanded',
  'subscribeClips',
  'takeClipBatch',
  'restoreClipBatch',
  'markOpsConsumed',
  'isOpConsumed',
  'clipState',
  'clientStateStore',
  // handoff prompt (prompt.ts)
  'buildClipContext',
  // send hook + diagnostics (register.tsx)
  'CLIP_SEND_STABLE_TOKEN',
  'installClipSend',
  'installClipSendOn',
  'clipSendDispatch',
  'installClipSendForSession',
  'restoreClipSendHooks',
  'clipSendState',
  'setClientDebugContext',
  'clientDebugLog',
]

/** Pending `setTimeout` callbacks; the retry checks drain them by hand. */
const timers = []

const sandbox = {
  console,
  JSON,
  Math,
  Date,
  Set,
  Map,
  String,
  Number,
  Object,
  Array,
  Promise,
  React: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
  truncate: (text, max) => {
    const value = String(text === undefined || text === null ? '' : text)
    return value.length > max ? value.slice(0, max - 1) + '…' : value
  },
  setTimeout: (fn, delay) => {
    timers.push({ fn, delay })
    return timers.length
  },
  clearTimeout: () => {},
  // Mirrors lib/client.js: remote.ts is part of the same factory scope.
  createRemote: (ctx) => (endpoint, args, signal) =>
    Promise.resolve(ctx.connection.rpc.call('/api', 'nudge/' + endpoint, { args: args || {} }, signal)),
}

/** One bundle-factory evaluation: fresh module scope, shared page global. */
function loadInstance(overrides) {
  const options = overrides || {}
  const source =
    '(function () {\n' +
    (options.store || storeSource) +
    '\n' +
    (options.prompt || promptSource) +
    '\n' +
    (options.send || sendHookSource) +
    '\nreturn {\n' +
    INSTANCE_EXPORTS.map((name) => name + ': ' + name).join(',\n') +
    '\n};\n})()'
  return runInNewContext(source, sandbox, { filename: 'clip-annotations-instance.js' })
}

const clip = (id, note, extra) =>
  Object.assign(
    {
      id,
      tabId: 'tab-1',
      tag: 'h1',
      selector: 'body > h1',
      note,
      text: 'Hero heading',
      thumbnail: 'data:image/png;base64,AAAA',
      screenshotPath: '.dsh/nudge/screenshots/' + id + '.png',
      pageUrl: 'https://example.test/',
      pageTitle: 'Example',
      createdAt: 1,
    },
    extra || {},
  )
const op = (id, property) => ({
  id,
  kind: 'style',
  selector: 'body > h1',
  property,
  before: '20px',
  after: '28px',
  syncStatus: 'synced',
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const run = loadInstance()

// ---------------------------------------------------------------- store
assert(run.clipPendingCount('s1') === 0, 'a fresh session has no pending clips')

run.insertClips('s1', { clips: [clip('a', 'first'), clip('b', 'second')], ops: [op('op1', 'font-size')], tabId: 'tab-1' })
const inserted = run.useClipEntry('s1')
assert(inserted.clips.length === 2, 'two clips are inserted')
assert(inserted.ops.length === 1, 'the applied visual edit joins the batch')
assert(inserted.expanded === true, 'inserting expands the tray')
assert(inserted.tabId === 'tab-1', 'the tray remembers its source tab')

run.insertClips('s1', { clips: [clip('a', 'first (edited)'), clip('c', 'third')], ops: [op('op1', 'font-size')], tabId: 'tab-1' })
const merged = run.useClipEntry('s1')
assert(merged.clips.length === 3, 're-inserting the same annotation does not duplicate it')
assert(merged.clips[0].note === 'first (edited)', 're-inserting refreshes the note')
assert(merged.clips[2].id === 'c', 'new clips append after the existing cards')
assert(merged.ops.length === 1, 'the same visual edit is not duplicated')

run.updateClipNote('s1', 'a', 'changed note')
assert(run.useClipEntry('s1').clips[0].note === 'changed note', 'editing a card updates the stored note')

run.setClipExpanded('s1', false)
assert(run.useClipEntry('s1').expanded === false, 'the chip can collapse the cards')
run.setClipExpanded('s1', true)
assert(run.useClipEntry('s1').expanded === true, 'the chip can expand the cards')

const taken = run.takeClipBatch('s1')
assert(taken && taken.clips.length === 3 && taken.ops.length === 1, 'a send reserves the whole pending batch')
assert(run.clipPendingCount('s1') === 0, 'reserved clips leave the composer while the send is in flight')

run.restoreClipBatch('s1', taken)
assert(run.clipPendingCount('s1') === 4, 'a rejected send restores the same cards')
assert(run.useClipEntry('s1').clips[0].note === 'changed note', 'restoring keeps card edits')

run.removeClip('s1', 'b')
assert(run.useClipEntry('s1').clips.length === 2, 'removing one card keeps the rest')
run.clearClipOps('s1')
assert(run.useClipEntry('s1').ops.length === 0, 'the visual-edit row can be cleared alone')
run.clearClips('s1')
assert(run.clipPendingCount('s1') === 0 && run.useClipEntry('s1').expanded === false, 'clearing drops every card and collapses the tray')

run.markOpsConsumed([op('op2', 'color')])
assert(run.isOpConsumed('op2') === true, 'a sent visual edit is marked consumed')
assert(run.isOpConsumed('op3') === false, 'unconsumed edits keep flowing into the next insert')

assert(
  run.clipPendingSessionIds().length === 0,
  'a cleared store reports no pending Session for the post-HMR reinstall',
)

// ------------------------------------------------------------- prompt
const context = run.buildClipContext(
  [clip('a', '标题字重再强化'), Object.assign(clip('b', 'second'), { screenshotPath: null })],
  [op('op1', 'font-size')],
)
assert(context.includes('【Visual Inspector'), 'the handoff opens with the Visual Inspector header')
assert(context.includes('https://example.test/'), 'the handoff carries the page URL')
assert(context.includes('## 标注（2 条）'), 'the handoff counts the annotation clips')
assert(context.includes('标题字重再强化'), 'the handoff carries the user note')
assert(context.includes('.dsh/nudge/screenshots/a.png'), 'the handoff carries the screenshot path')
assert(context.includes('## 已实时生效的视觉修改（1 条）'), 'the handoff includes applied visual edits')
assert(context.includes('font-size'), 'the handoff names the edited property')

// ----------------------------------------------------------- send hook
const original = function (session, text, attachmentIds, mode) {
  return Promise.resolve({ kind: 'success', received: { session, text, attachmentIds, mode } })
}
const service = { sendSession: original }
const scope = { get: (key) => (key === 'conversation' ? service : undefined) }
const dispose = run.installClipSend(scope)
assert(service.sendSession !== original && service.sendSession.__dshnudgeClipSend === true, 'installing wraps the scoped sendSession once')

run.insertClips('s1', { clips: [clip('a', '发送上下文')], ops: [op('op9', 'color')], tabId: 'tab-1' })
const sent = await service.sendSession({ sessionId: 's1' }, '请按批注修改', [], 'queue')
assert(sent.received.text.startsWith('请按批注修改'), 'the user text leads the payload')
assert(sent.received.text.includes('## 标注（1 条）'), 'the payload appends the clip context')
assert(sent.received.text.includes('发送上下文'), 'the payload carries the note')
assert(run.clipPendingCount('s1') === 0, 'an accepted send clears the tray')
assert(run.isOpConsumed('op9') === true, 'an accepted send marks the visual edits consumed')

run.insertClips('s1', { clips: [clip('z', 'slash')], ops: [], tabId: 'tab-1' })
await service.sendSession({ sessionId: 's1' }, '/goal ship it', [], 'queue')
assert(run.clipPendingCount('s1') === 1, 'slash commands pass through without consuming the clips')

const failingService = { sendSession: () => Promise.resolve({ kind: 'failed', text: 'nope' }) }
const failingScope = { get: (key) => (key === 'conversation' ? failingService : undefined) }
run.installClipSend(failingScope)
run.insertClips('s1', { clips: [clip('r', 'retry me')], ops: [], tabId: 'tab-1' })
await failingService.sendSession({ sessionId: 's1' }, 'hello', [], 'queue')
assert(run.clipPendingCount('s1') === 2, 'a rejected send keeps the cards for retry')

const throwingService = {
  sendSession: () => Promise.reject(new Error('transport down')),
}
const throwingScope = { get: (key) => (key === 'conversation' ? throwingService : undefined) }
run.installClipSend(throwingScope)
let threw = false
try {
  await throwingService.sendSession({ sessionId: 's1' }, 'hello', [], 'queue')
} catch (error) {
  threw = true
}
assert(threw, 'a transport failure still rejects to the composer')
assert(run.clipPendingCount('s1') === 2, 'a transport failure restores the cards')

service.sendSession = original
dispose()
assert(service.sendSession === original, 'disposing the plugin restores the original sendSession')

run.clearClips('s1')

// ------------------------------------------------- session-scoped install
// DSH provides the conversation service per Session scope; the plugin wraps it
// lazily from `sessions.scope(sessionId).get('conversation')`.
const scopedService = { sendSession: function () { return Promise.resolve({ kind: 'success' }) } }
const sessionsService = {
  scope: (id) => (id === 's1' ? { get: (key) => (key === 'conversation' ? scopedService : undefined) } : null),
}
const pluginCtx = { get: (key) => (key === 'sessions' ? sessionsService : undefined) }
assert(run.installClipSendForSession(pluginCtx, 's1') === true, 'a Session scope exposes a wrappable conversation service')
assert(scopedService.sendSession.__dshnudgeClipSend === true, 'the Session-scoped composer send path is wrapped')
const wrappedOnce = scopedService.sendSession
assert(run.installClipSendForSession(pluginCtx, 's1') === true, 'installing twice for one Session stays true')
assert(scopedService.sendSession === wrappedOnce, 'installing twice never double-wraps the send path')
assert(run.installClipSendForSession(pluginCtx, 'missing') === false, 'an unknown Session installs nothing')
assert(run.installClipSendForSession(pluginCtx, '') === false, 'an empty Session id installs nothing')
run.restoreClipSendHooks()
assert(!scopedService.sendSession.__dshnudgeClipSend, 'plugin disposal restores every Session-scoped send path')

// ---------------------------------------------- HMR: shared store + dispatch
const runA = loadInstance()
const runB = loadInstance()
assert(runA.clipState() === runB.clipState(), 'two module instances share one clip store')
assert(runA.clipSendState() === runB.clipSendState(), 'two module instances share one send dispatcher state')

let crossNotified = 0
const unsubscribe = runA.subscribeClips(() => {
  crossNotified += 1
})
runA.insertClips('shared-1', { clips: [clip('shared-a', 'from A')], ops: [], tabId: 'tab-1' })
assert(runB.clipPendingCount('shared-1') === 1, 'a new module instance sees clips inserted by the old one')
assert(crossNotified >= 1, 'a listener registered by the old instance is notified by the new one')
runB.insertClips('shared-1', { clips: [clip('shared-b', 'from B')], ops: [], tabId: 'tab-1' })
assert(runA.useClipEntry('shared-1').clips.length === 2, 'the old module instance sees clips inserted by the new one')
unsubscribe()
assert(runB.clipPendingSessionIds().indexOf('shared-1') >= 0, 'the post-HMR reinstall finds the pending Session')

/** Give one prompt module a recognisable old implementation. */
function withStalePrompt(source) {
  const needle = "return lines.join('\\n');"
  const index = source.lastIndexOf(needle)
  if (index < 0) throw new Error('cannot locate the buildClipContext return')
  return source.slice(0, index) + "lines.push('STALE-IMPL');\n  " + needle + source.slice(index + needle.length)
}

const oldRun = loadInstance({ prompt: withStalePrompt(promptSource) })
const newRun = loadInstance()
run.clearClips('shared-1')
const dispatchService = {
  calls: 0,
  sendSession: function (session, text, attachmentIds, mode) {
    this.calls += 1
    return Promise.resolve({ kind: 'success', received: { text, mode } })
  },
}
const dispatchScope = { get: (key) => (key === 'conversation' ? dispatchService : undefined) }
const dispatchOriginal = dispatchService.sendSession
const installsBefore = oldRun.clipSendState().installs
const adoptedBefore = oldRun.clipSendState().adopted
oldRun.installClipSend(dispatchScope)
const stableWrapper = dispatchService.sendSession
assert(stableWrapper !== undefined && stableWrapper.__dshnudgeClipSend === true, 'the installed wrapper is marked plugin-owned')
assert(
  stableWrapper.__dshnudgeClipStable === oldRun.CLIP_SEND_STABLE_TOKEN,
  'the installed wrapper carries the page-wide stable token',
)
assert(oldRun.clipSendState().installs === installsBefore + 1, 'the first install counts one wrapper')

const restoreAdopted = newRun.installClipSend(dispatchScope)
assert(typeof restoreAdopted === 'function', 'a second module instance reports a usable install')
assert(dispatchService.sendSession === stableWrapper, 'a new module instance adopts the stable wrapper instead of chaining another')
assert(newRun.clipSendState().installs === installsBefore + 1, 'adopting a stable wrapper never installs a second one')
assert(newRun.clipSendState().adopted === adoptedBefore + 1, 'the adoption branch is recorded for diagnostics')
assert(
  newRun.clipSendState().dispatch === newRun.clipSendDispatch,
  'adopting the existing wrapper republishes the newest dispatcher',
)

newRun.insertClips('dispatch-1', { clips: [clip('dispatch-a', 'new implementation')], ops: [op('dispatch-op', 'color')], tabId: 'tab-1' })
const dispatched = await dispatchService.sendSession({ sessionId: 'dispatch-1' }, '请处理', [], 'queue')
assert(dispatched.received.text.includes('【Visual Inspector'), 'the stable wrapper sends the clip context')
assert(!dispatched.received.text.includes('STALE-IMPL'), 'the stable wrapper runs the newest dispatcher, not the installer closure')
assert(dispatched.received.text.includes('new implementation'), 'the newest store supplies the pending note')
assert(dispatchService.calls === 1, 'the original send path is called exactly once')

newRun.insertClips('dispatch-1', { clips: [clip('dispatch-b', 'again')], ops: [], tabId: 'tab-1' })
const prefilled = '【Visual Inspector · 网页标注与视觉修改】已在草稿里的上下文'
const dispatchedAgain = await dispatchService.sendSession({ sessionId: 'dispatch-1' }, prefilled, [], 'queue')
assert(dispatchedAgain.received.text === prefilled, 'a draft that already carries the header is not appended twice')
assert(newRun.clipPendingCount('dispatch-1') === 0, 'the pending batch is consumed by the adopted wrapper')

oldRun.restoreClipSendHooks()
assert(dispatchService.sendSession === dispatchOriginal, 'unloading the installing instance restores the original sendSession')
assert(
  oldRun.clipSendState().dispatch === newRun.clipSendDispatch,
  'unloading an older instance leaves a newer instance dispatcher in place',
)

// ------------------------------------- HMR from a pre-fix ("zombie") wrapper
let staleCalls = 0
function legacyWrapper(session, text, attachmentIds, mode) {
  staleCalls += 1
  return legacyOriginal.apply(this, arguments)
}
const legacyOriginal = function (session, text, attachmentIds, mode) {
  return Promise.resolve({ kind: 'success', received: { text, mode } })
}
legacyWrapper.__dshnudgeClipSend = true
// A cordis conversation service keeps the real method on its prototype; the
// stale wrapper only shadows it as an own property.
const legacyService = Object.create({ sendSession: legacyOriginal })
legacyService.sendSession = legacyWrapper
const legacyScope = { get: (key) => (key === 'conversation' ? legacyService : undefined) }
const adoptRun = loadInstance()
const chainsBefore = adoptRun.clipSendState().chains
adoptRun.insertClips('legacy-1', { clips: [clip('legacy-a', 'after hot reload')], ops: [], tabId: 'tab-1' })
const restoreLegacy = adoptRun.installClipSend(legacyScope)
assert(legacyService.sendSession !== legacyWrapper, 'an unrecognised pre-fix wrapper is wrapped once, never skipped')
assert(legacyService.sendSession.__dshnudgeClipSend === true, 'the chained wrapper still carries the legacy marker')
assert(
  legacyService.sendSession.__dshnudgeClipStable === adoptRun.CLIP_SEND_STABLE_TOKEN,
  'the chained wrapper is marked as the stable one',
)
assert(adoptRun.clipSendState().chains === chainsBefore + 1, 'exactly one wrapper is chained over the zombie wrapper')
assert(
  adoptRun.clipSendState().dispatch === adoptRun.clipSendDispatch,
  'the zombie path also publishes the newest dispatcher before wrapping',
)
const legacySent = await legacyService.sendSession({ sessionId: 'legacy-1' }, '请按批注改', [], 'queue')
assert(legacySent.received.text.includes('【Visual Inspector'), 'the chained wrapper appends the clip context')
assert(legacySent.received.text.includes('after hot reload'), 'the chained wrapper reads the shared store')
assert(staleCalls === 0, 'the normal path calls the original method, not the zombie wrapper')
restoreLegacy()
assert(legacyService.sendSession === legacyWrapper, 'unload restores the previous (zombie) wrapper it wrapped')

// ------------------------------------- unload never removes a foreign wrapper
const ownerRun = loadInstance()
const otherService = { sendSession: function () { return Promise.resolve({ kind: 'success' }) } }
const otherScope = { get: (key) => (key === 'conversation' ? otherService : undefined) }
ownerRun.installClipSend(otherScope)
const foreignWrapper = function () {
  return Promise.resolve({ kind: 'success' })
}
otherService.sendSession = foreignWrapper
ownerRun.restoreClipSendHooks()
assert(otherService.sendSession === foreignWrapper, 'unload never removes a wrapper another install owns')
assert(
  ownerRun.clipSendState().dispatch === null,
  'unload clears the shared dispatcher published by the unloading instance',
)

// ------------------------------------------- bounded retry while clips pending
const retryService = { sendSession: function () { return Promise.resolve({ kind: 'success' }) } }
let scopeReady = false
const retrySessions = {
  scope: (id) =>
    scopeReady && id === 'retry-1' ? { get: (key) => (key === 'conversation' ? retryService : undefined) } : undefined,
}
const retryCtx = { get: (key) => (key === 'sessions' ? retrySessions : undefined) }
const retryRun = loadInstance()
retryRun.insertClips('retry-1', { clips: [clip('retry-a', 'pending')], ops: [], tabId: 'tab-1' })
const timersBefore = timers.length
assert(retryRun.installClipSendForSession(retryCtx, 'retry-1') === false, 'an unresolvable Session scope reports failure instead of throwing')
assert(timers.length === timersBefore + 1, 'a failed install schedules one bounded retry while cards are pending')
assert(timers[timersBefore].delay > 0, 'the retry is delayed rather than immediate')
scopeReady = true
timers[timersBefore].fn()
assert(retryService.sendSession.__dshnudgeClipSend === true, 'the retry installs the wrapper once the Session scope resolves')
assert(
  retryService.sendSession.__dshnudgeClipStable === retryRun.CLIP_SEND_STABLE_TOKEN,
  'the retried install is the stable wrapper',
)


// --------------------------------- real cordis: zombie wrapper regression
// A plain-object double cannot reproduce the cordis traceable-Proxy semantics
// that caused the bug, so this block drives the real @deepseek-ai/cordis
// Context/Service implementation (a peer dependency; skipped when it is not
// installed in this checkout).
let cordis = null
try {
  cordis = await import('@deepseek-ai/cordis')
} catch (error) {
  cordis = null
}
if (cordis === null) {
  console.log('skip - real cordis regression (peer dependency @deepseek-ai/cordis is not installed)')
} else {
  const { Context, Service } = cordis
  const CORDIS_ORIGINAL = Symbol.for('cordis.original')

  class CordisConversation extends Service {
    constructor(ctx) {
      super(ctx, 'conversation')
      this.sent = []
    }
    async sendSession(session, text) {
      this.sent.push(text)
      return { kind: 'success', received: { text } }
    }
  }

  const cordisCtx = new Context()
  const cordisRaw = new CordisConversation(cordisCtx)
  const cordisProxy = cordisCtx.get('conversation')
  assert(cordisProxy[CORDIS_ORIGINAL] === cordisRaw, 'Symbol.for(cordis.original) exposes the raw cordis service')

  // --- the pre-fix module instance installs a wrapper with an identity restore
  const legacyOriginal = cordisProxy.sendSession
  const oldSendWithClips = function (session, text) {
    return legacyOriginal.apply(this, arguments)
  }
  oldSendWithClips.__dshnudgeClipSend = true
  cordisProxy.sendSession = oldSendWithClips
  const oldRestore = function () {
    if (cordisProxy.sendSession === oldSendWithClips) cordisProxy.sendSession = legacyOriginal
  }
  oldRestore()
  assert(
    cordisProxy.sendSession !== oldSendWithClips,
    'reading sendSession through the traceable Proxy never returns the installed function itself',
  )
  assert(
    cordisRaw.sendSession === oldSendWithClips,
    'the pre-fix identity restore is a no-op: the zombie wrapper stays on the raw singleton',
  )

  // --- the new module instance (HMR) chains one stable wrapper over it
  const cordisRun = loadInstance()
  cordisRun.insertClips('cordis-1', { clips: [clip('cordis-a', '经真实 cordis 发送')], ops: [], tabId: 'tab-1' })
  const rootScope = { get: (key) => (key === 'conversation' ? cordisCtx.get('conversation') : undefined) }
  const restoreCordis = cordisRun.installClipSend(rootScope)
  assert(typeof restoreCordis === 'function', 'the new module instance installs against the raw cordis singleton')
  assert(
    cordisRaw.sendSession.__dshnudgeClipStable === cordisRun.CLIP_SEND_STABLE_TOKEN,
    'the stable wrapper is the raw service own property (marker readable through the Proxy)',
  )
  assert(
    cordisRun.clipSendState().dispatch === cordisRun.clipSendDispatch,
    'the stable wrapper runs the newest dispatcher on the real cordis service',
  )
  const cordisSent = await cordisCtx.get('conversation').sendSession({ sessionId: 'cordis-1' }, '真实 cordis 路径', [], 'queue')
  assert(cordisSent.kind === 'success', 'the real cordis send resolves a success result')
  assert(
    cordisRaw.sent[cordisRaw.sent.length - 1].includes('【Visual Inspector'),
    'the real cordis send carries the Visual Inspector context',
  )
  assert(
    cordisRaw.sent[cordisRaw.sent.length - 1].includes('经真实 cordis 发送'),
    'the real cordis send carries the pending note from the shared store',
  )
  restoreCordis()
  assert(cordisRaw.sendSession === oldSendWithClips, 'unload restores the zombie wrapper it wrapped (not the prototype method)')
  delete cordisRaw.sendSession
  assert(
    cordisRaw.sendSession === CordisConversation.prototype.sendSession,
    'deleting the own wrapper exposes the original prototype method again',
  )

  // --- a clean cordis service: unload deletes the own wrapper
  const cleanCtx = new Context()
  const cleanRaw = new CordisConversation(cleanCtx)
  const cleanRun = loadInstance()
  const cleanScope = { get: (key) => (key === 'conversation' ? cleanCtx.get('conversation') : undefined) }
  const cleanRestore = cleanRun.installClipSend(cleanScope)
  assert(
    cleanRaw.sendSession.__dshnudgeClipStable === cleanRun.CLIP_SEND_STABLE_TOKEN,
    'a clean cordis service gets the stable wrapper as an own property',
  )
  assert(
    cleanRaw.sendSession !== CordisConversation.prototype.sendSession,
    'the own wrapper shadows the prototype method while installed',
  )
  cleanRestore()
  assert(!Object.hasOwn(cleanRaw, 'sendSession'), 'unload deletes the own wrapper so the prototype method is visible again')
  assert(
    cleanRaw.sendSession === CordisConversation.prototype.sendSession,
    'the prototype method is restored after unload',
  )

  // --- the root `ctx.inject(['conversation'])` path the plugin's apply uses:
  // it fires asynchronously and resolves the same root singleton.
  const rootCtx = new Context()
  const rootRaw = new CordisConversation(rootCtx)
  const rootRun = loadInstance()
  let rootScopeSeen = false
  let rootScopeSameRaw = false
  rootCtx.inject(['conversation'], function (scope) {
    rootScopeSeen = true
    try {
      rootScopeSameRaw = scope.get('conversation')[CORDIS_ORIGINAL] === rootRaw
    } catch (error) {
      rootScopeSameRaw = false
    }
    rootRun.installClipSend(scope)
  })
  await tick()
  assert(rootScopeSeen, 'the root conversation injection fires when the service is available')
  assert(rootScopeSameRaw, 'the injected root scope resolves the same raw conversation singleton')
  assert(
    rootRaw.sendSession.__dshnudgeClipStable === rootRun.CLIP_SEND_STABLE_TOKEN,
    'the root injection path installs the stable wrapper on the singleton',
  )
  rootRun.insertClips('cordis-root-1', { clips: [clip('cordis-root-a', '根注入路径')], ops: [], tabId: 'tab-1' })
  const rootSent = await rootCtx.get('conversation').sendSession({ sessionId: 'cordis-root-1' }, 'root inject', [], 'queue')
  assert(
    rootRaw.sent[rootRaw.sent.length - 1].includes('根注入路径'),
    'a send through the root-injected wrapper carries the clip context',
  )
  assert(rootSent.kind === 'success', 'the root-inject send resolves normally')
  rootRun.restoreClipSendHooks()
}

// ------------------------------------------------ diagnostics are best-effort
const debugCalls = []
const debugCtx = {
  get: () => undefined,
  connection: {
    rpc: {
      call: (route, name, payload) => {
        debugCalls.push({ route, name, payload })
        return Promise.reject(new Error('diagnostics offline'))
      },
    },
  },
}
const debugRun = loadInstance()
debugRun.setClientDebugContext(debugCtx)
let unhandled = 0
const onUnhandled = () => {
  unhandled += 1
}
process.on('unhandledRejection', onUnhandled)
debugRun.clientDebugLog('test.event', { ok: true })
const debugService = { sendSession: function () { return Promise.resolve({ kind: 'success' }) } }
debugRun.installClipSend({ get: (key) => (key === 'conversation' ? debugService : undefined) })
await tick()
await tick()
process.removeListener('unhandledRejection', onUnhandled)
assert(debugCalls.length >= 2, 'diagnostics records are sent through the Host RPC')
assert(
  debugCalls.every((call) => call.route === '/api' && call.name === 'nudge/debugLog'),
  'diagnostics use the nudge/debugLog remote method',
)
const loggedEvent = debugCalls[0].payload.args
assert(loggedEvent.event === 'test.event', 'the diagnostics entry carries the event name')
assert(typeof loggedEvent.ts === 'number' && typeof loggedEvent.instance === 'string', 'the diagnostics entry carries a timestamp and instance id')
assert(
  debugCalls.some((call) => call.payload.args.event === 'install.branch'),
  'install branch decisions are reported to the diagnostics log',
)
assert(unhandled === 0, 'a failing diagnostics RPC is swallowed (no unhandled rejection)')

if (failures > 0) {
  console.error('\n' + failures + ' of ' + checks + ' clip-annotation check(s) failed')
  process.exit(1)
}
console.log(checks + ' clip-annotation checks passed')
