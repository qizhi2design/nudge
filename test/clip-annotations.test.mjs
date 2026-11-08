/**
 * Clip-annotation draft store + handoff prompt + send hook.
 *
 * The three pieces live in different files but share one Client factory scope at
 * runtime, so this test concatenates their plain-JavaScript sources, evaluates
 * them in one VM context, and drives the same functions the bundle calls.
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

const start = registerSource.indexOf('function installClipSend(scope) {')
const end = registerSource.indexOf('function readLocaleDict(')
if (start < 0 || end < 0) throw new Error('cannot locate installClipSend in register.tsx')
const sendHookSource = registerSource.slice(start, end)

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
}
runInNewContext(storeSource + '\n' + promptSource + '\n' + sendHookSource, sandbox, { filename: 'clip-annotations.js' })

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

// ---------------------------------------------------------------- store
assert(sandbox.clipPendingCount('s1') === 0, 'a fresh session has no pending clips')

sandbox.insertClips('s1', { clips: [clip('a', 'first'), clip('b', 'second')], ops: [op('op1', 'font-size')], tabId: 'tab-1' })
const inserted = sandbox.useClipEntry('s1')
assert(inserted.clips.length === 2, 'two clips are inserted')
assert(inserted.ops.length === 1, 'the applied visual edit joins the batch')
assert(inserted.expanded === true, 'inserting expands the tray')
assert(inserted.tabId === 'tab-1', 'the tray remembers its source tab')

sandbox.insertClips('s1', { clips: [clip('a', 'first (edited)'), clip('c', 'third')], ops: [op('op1', 'font-size')], tabId: 'tab-1' })
const merged = sandbox.useClipEntry('s1')
assert(merged.clips.length === 3, 're-inserting the same annotation does not duplicate it')
assert(merged.clips[0].note === 'first (edited)', 're-inserting refreshes the note')
assert(merged.clips[2].id === 'c', 'new clips append after the existing cards')
assert(merged.ops.length === 1, 'the same visual edit is not duplicated')

sandbox.updateClipNote('s1', 'a', 'changed note')
assert(sandbox.useClipEntry('s1').clips[0].note === 'changed note', 'editing a card updates the stored note')

sandbox.setClipExpanded('s1', false)
assert(sandbox.useClipEntry('s1').expanded === false, 'the chip can collapse the cards')
sandbox.setClipExpanded('s1', true)
assert(sandbox.useClipEntry('s1').expanded === true, 'the chip can expand the cards')

const taken = sandbox.takeClipBatch('s1')
assert(taken && taken.clips.length === 3 && taken.ops.length === 1, 'a send reserves the whole pending batch')
assert(sandbox.clipPendingCount('s1') === 0, 'reserved clips leave the composer while the send is in flight')

sandbox.restoreClipBatch('s1', taken)
assert(sandbox.clipPendingCount('s1') === 4, 'a rejected send restores the same cards')
assert(sandbox.useClipEntry('s1').clips[0].note === 'changed note', 'restoring keeps card edits')

sandbox.removeClip('s1', 'b')
assert(sandbox.useClipEntry('s1').clips.length === 2, 'removing one card keeps the rest')
sandbox.clearClipOps('s1')
assert(sandbox.useClipEntry('s1').ops.length === 0, 'the visual-edit row can be cleared alone')
sandbox.clearClips('s1')
assert(sandbox.clipPendingCount('s1') === 0 && sandbox.useClipEntry('s1').expanded === false, 'clearing drops every card and collapses the tray')

sandbox.markOpsConsumed([op('op2', 'color')])
assert(sandbox.isOpConsumed('op2') === true, 'a sent visual edit is marked consumed')
assert(sandbox.isOpConsumed('op3') === false, 'unconsumed edits keep flowing into the next insert')

// ------------------------------------------------------------- prompt
const context = sandbox.buildClipContext(
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
const dispose = sandbox.installClipSend(scope)
assert(service.sendSession !== original && service.sendSession.__dshnudgeClipSend === true, 'installing wraps the scoped sendSession once')

sandbox.insertClips('s1', { clips: [clip('a', '发送上下文')], ops: [op('op9', 'color')], tabId: 'tab-1' })
const sent = await service.sendSession({ sessionId: 's1' }, '请按批注修改', [], 'queue')
assert(sent.received.text.startsWith('请按批注修改'), 'the user text leads the payload')
assert(sent.received.text.includes('## 标注（1 条）'), 'the payload appends the clip context')
assert(sent.received.text.includes('发送上下文'), 'the payload carries the note')
assert(sandbox.clipPendingCount('s1') === 0, 'an accepted send clears the tray')
assert(sandbox.isOpConsumed('op9') === true, 'an accepted send marks the visual edits consumed')

sandbox.insertClips('s1', { clips: [clip('z', 'slash')], ops: [], tabId: 'tab-1' })
await service.sendSession({ sessionId: 's1' }, '/goal ship it', [], 'queue')
assert(sandbox.clipPendingCount('s1') === 1, 'slash commands pass through without consuming the clips')

const failingService = { sendSession: () => Promise.resolve({ kind: 'failed', text: 'nope' }) }
const failingScope = { get: (key) => (key === 'conversation' ? failingService : undefined) }
sandbox.installClipSend(failingScope)
sandbox.insertClips('s1', { clips: [clip('r', 'retry me')], ops: [], tabId: 'tab-1' })
await failingService.sendSession({ sessionId: 's1' }, 'hello', [], 'queue')
assert(sandbox.clipPendingCount('s1') === 2, 'a rejected send keeps the cards for retry')

const throwingService = {
  sendSession: () => Promise.reject(new Error('transport down')),
}
const throwingScope = { get: (key) => (key === 'conversation' ? throwingService : undefined) }
sandbox.installClipSend(throwingScope)
let threw = false
try {
  await throwingService.sendSession({ sessionId: 's1' }, 'hello', [], 'queue')
} catch (error) {
  threw = true
}
assert(threw, 'a transport failure still rejects to the composer')
assert(sandbox.clipPendingCount('s1') === 2, 'a transport failure restores the cards')

service.sendSession = original
dispose()
assert(service.sendSession === original, 'disposing the plugin restores the original sendSession')

if (failures > 0) {
  console.error('\n' + failures + ' of ' + checks + ' clip-annotation check(s) failed')
  process.exit(1)
}
console.log(checks + ' clip-annotation checks passed')
