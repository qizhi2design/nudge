# 工作区版本与热更新（Workspace Versions）

> 本轮升级的冻结契约。Host 与 Client 两个半区都按这份文档实现；改契约先改这里。

## 1. 目标

在右侧「轻推」标签页里把「本地工作区 → 页面 → 版本 → 提交」串成一条闭环：

1. **读文件**：扫描会话工作区里的 HTML 文件，点一下就在页面里打开。
2. **看版本**：识别工作区的 git 仓库、当前分支、脏文件、该 HTML 文件的历史版本。
3. **切版本**：切换分支；把当前 HTML 恢复成某个历史 commit 的版本（工作区文件随之变化，页面自动刷新）。
4. **提交**：直接在这个面板里选文件、写 message、`git commit`。
5. **热更新**：工作区文件被任何来源修改（插件自己的样式同步、用户手改、Agent/AI 编辑）后，页面自动刷新；标注/编辑过程中不打断用户，改为显示「有更新」提示。

## 2. 安全边界（必须遵守）

- 所有 git 命令都用 `execFile('git', args, { cwd, timeout, maxBuffer })`，**不经 shell**；分支名、commit、路径都先校验。
- 只操作**会话 cwd 内**的仓库：`git rev-parse --show-toplevel` 的结果必须等于 cwd 或位于 cwd 内；仓库在工作区外时 `git.available=false`。
- 仓库根与 `sourceRoot` 必须重叠，三种情况都支持：
  - `repoRoot === sourceRoot`（默认，`relativeRoot=''`、`sourceSubdir=''`）；
  - `repoRoot` 在 `sourceRoot` 内（嵌套仓库，`relativeRoot` 非空）；
  - `sourceRoot` 在 `repoRoot` 内（常见：`sourceRoot` 指向仓库子目录，`sourceSubdir` 非空）。
  三者都不满足（两个目录互不相交）时 `git.available=false`、`error='outside-workspace'`。
- **所有 API 路径始终相对 `sourceRoot`**；Host 内部按 `relativeRoot` / `sourceSubdir` 换算成相对仓库根的路径。`git.changes` 只列出 `sourceRoot` 内的变更（sourceRoot 之外的仓库变更不进入面板、也不能用 `files` 单独提交）；`gitCommit` 省略 `files` 时执行 `git add -A`，那是仓库范围的提交。
- 写操作（切换分支、恢复文件、提交）在 `policy.mode === 'read-only'` 时**拒绝**（抛错）；读操作（扫描、日志、预览、轮询）不受限。
- 路径校验：拒绝绝对路径、`..`、NUL、`.git` 段；拼绝对路径后 `realpath` 必须仍在根内（防止符号链接逃逸）。
- 分支名必须来自当前本地分支白名单（`refs/heads`），commit 必须匹配 `/^[0-9a-fA-F]{4,40}$/`。
- 静态预览服务器只在 `127.0.0.1` 监听，端口用 `listen(0)` 自动分配；拒绝目录穿越、符号链接逃逸、点文件（`.` 开头段）、`node_modules` 段与 `.git` 段；只允许 GET/HEAD；`Cache-Control: no-store`。
- 不实现 push / reset --hard / clean；分支切换遇到脏工作区只允许「先提交」或「stash 后切换」。

## 3. 远程 API（namespace `nudge`）

沿用现有 `nudge/*` 约定：Client 通过 `createRemote(ctx)` 调用，参数是一个对象：

```js
remote('workspace', { session: sessionId })
```

所有路径字段都是 **相对 `sourceRoot`、以 `/` 分隔** 的字符串。失败抛 `Error('nudge: ...')`；预期内的状态（脏工作区等）用返回值表达，不抛错。

### 3.1 `workspace(session)`

```jsonc
{
  "sessionId": "session-1",
  "cwd": "/abs/workspace",
  "sourceRoot": "/abs/workspace",
  "writable": true,
  "truncated": false,                  // HTML 扫描是否被预算截断
  "git": {
    "available": true,
    "repoRoot": "/abs/workspace",
    "relativeRoot": "",                // repoRoot 相对 sourceRoot，'' = 同一个目录
    "branch": "main",
    "detached": false,
    "branches": [ { "name": "main", "current": true }, { "name": "feat-a", "current": false } ],
    "clean": false,
    "changes": [
      { "path": "demo/index.html", "index": " ", "worktree": "M", "label": "modified" }
    ],
    "error": null                      // 不可用时为 'not-a-repository' 等稳定原因
  },
  "htmlFiles": [
    { "path": "demo/index.html", "name": "index.html", "dir": "demo", "size": 1234, "mtime": 1760000000000, "change": "modified" }
  ],
  "preview": { "active": false, "port": 0, "baseUrl": "" }
}
```

- `changes[].label` ∈ `modified | added | deleted | renamed | untracked | conflicted`；重命名项可带 `from`。
- `htmlFiles` 按 path 排序，跳过 `node_modules / .git / .dsh / dist / build / out / .next / .nuxt / .cache / coverage` 等目录与点目录；预算 `config.maxScanFiles`（默认 400），深度上限 10。
- `htmlFiles[].change` 来自 `git.changes`，没有就是 `null`。
- 没有 git 时 `git.available=false`、`repoRoot=''`、`branches=[]`、`changes=[]`、`clean=true`。

### 3.2 `gitLog(session, file?)`

`file` 省略时返回整个仓库的最近提交。

```jsonc
{
  "file": "demo/index.html",
  "commits": [
    { "hash": "<40 hex>", "short": "abc1234", "author": "purity3",
      "date": "2026-11-08T09:00:00+08:00", "subject": "feat: demo page" }
  ]
}
```

最多 40 条；文件未跟踪时 `commits` 可能为空。`gitLog` 读操作，不需要写权限。

### 3.3 `gitSwitch(session, branch, options?)`

`options = { stash?: boolean }`。

```jsonc
// 成功
{ "ok": true, "branch": "feat-a", "stashed": false, "clean": true, "git": { /* 同 3.1 git */ } }
// 工作区脏且没有要求 stash
{ "ok": false, "reason": "dirty", "git": { /* 同 3.1 git */ } }
// 其他失败
{ "ok": false, "reason": "switch-failed", "message": "..." , "git": { ... } }
```

- 已在目标分支 → `ok:true, stashed:false`。
- `stash:true` 时先 `git stash push --include-untracked -m ...`；切换失败则尽力 `git stash pop`，并在 `message` 里说明。
- 分支不在白名单里直接抛错。

### 3.4 `gitRestoreFile(session, file, commit)`

```jsonc
{ "ok": true, "file": "demo/index.html", "commit": "abc1234", "status": "restored" }
```

执行 `git checkout <commit> -- <repoRelativePath>`：**只改工作区+索引里的这一个文件**，不动分支指针。文件在目标 commit 里不存在时抛错。写操作，read-only 拒绝。

### 3.5 `gitCommit(session, message, files?)`

`files` 是相对 `sourceRoot` 的路径数组；省略/空数组 = `git add -A` 全部变更。

```jsonc
// 成功
{ "ok": true, "committed": true,
  "commit": { "hash": "<40 hex>", "short": "abc1234", "subject": "..." },
  "git": { /* 同 3.1 git */ } }
// 没有可提交内容
{ "ok": true, "committed": false, "reason": "nothing-to-commit", "git": { ... } }
```

- `message` trim 后为空 → 抛错；超过 4000 字符截断。
- `files` 只接受当前 `changes` 里出现过的路径（未知路径抛错）。
- 尊重用户 hooks；hook 失败把 stderr 摘要放进错误消息。
- 写操作，read-only 拒绝。

### 3.6 `previewOpen(session, file?)`

为 `sourceRoot` 启动（或复用）一个静态服务器，返回可直接放进 webview 的 URL。

```jsonc
{ "ok": true, "port": 43127, "baseUrl": "http://127.0.0.1:43127/",
  "url": "http://127.0.0.1:43127/demo/index.html", "file": "demo/index.html",
  "root": "/abs/workspace" }
```

- `file` 省略时 `url = baseUrl`（请求 `/` 时服务根目录的 `index.html`，没有就 404 文本）。
- 同一 `sourceRoot` 复用同一个服务器；服务器生命周期到插件 Host 半区 dispose 或 `previewStop`。

### 3.7 `previewStop(session)`

```jsonc
{ "ok": true, "root": "/abs/workspace" }
```

关闭该 root 的静态服务器与 watcher（测试与「停止预览」用）。

### 3.8 `watchPoll(session)`

Client 轮询（~900ms）。第一次调用为当前 root 启动 watcher。

```jsonc
{ "revision": 12, "root": "/abs/workspace", "watching": true,
  "changed": [ { "path": "demo/index.html", "at": 1760000000000 } ] }
```

- `revision` 从 0 开始单调递增；debounce 120ms；`changed` 保留最近 8 条（不 drain）。
- `fs.watch(root, { recursive: true })` 为主；不可用时退化为 Host 内部 ~1000ms 有界 stat 快照轮询。
- 忽略 `.git`、`node_modules`、`dist`、`.dsh` 等目录内的变化。

## 4. Host 结构

```
src/host/
├── index.ts                        # 现有远程 API + 新增 workspace/git 端点接线
├── workspace.ts                    # 新：workspace 域 facade（打包入口）
└── domains/workspace/
    ├── index.ts                    # createWorkspaceDomain(deps) 组合各能力
    ├── git.ts                      # 仓库识别 / status / branches / log / switch / restore / commit
    ├── files.ts                    # 有界 HTML 扫描
    └── preview.ts                  # 静态服务器 registry + watcher registry
lib/index.js                        # 构建产物
lib/workspace.js                    # 新构建产物（scripts/build-host.mjs 新增第三个输出）
```

`src/host/index.ts` 里：

```ts
import { createWorkspaceDomain } from './workspace.js'
// apply(ctx, rawConfig) 内：
const workspace = createWorkspaceDomain({ ctx, config, sessionCwd, sessionPolicy, resolveSourceRoot, pathApiFor })
ctx.effect(() => () => workspace.dispose())
```

远程方法里先 `requireSession(sessionId)` → `cwd` → `resolveSourceRoot` → 把 `{ cwd, sourceRoot, policy, config }` 交给 domain。

## 5. Client 结构

```
src/client/domains/workspace/
├── git-store.ts        # 纯函数：hotReloadDecision、状态标签、路径/时间格式化、请求参数拼装
└── git-panel.tsx       # NudgeWorkspacePanel：文件 / 版本 / 提交 三个 tab
```

- `body.tsx`：`workspaceOpen` 本地状态；热更新轮询 effect；工具栏新 props；`onNavigate` 复用现有 `navigate()`。
- `toolbar.tsx`：新增「工作区版本」按钮（GitBranch 图标）与热更新开关（RefreshCw，`aria-pressed`；有 pending 时高亮）。
- `store.ts` 的 tab 默认值增加 `hotReload: true`、`reloadPending: false`、`workspace: null`。
- 面板宽度 300px，视觉沿用 `DomTreePanel`（边框、header、关闭按钮、`theme` token）。

### 热更新规则（Client）

```js
hotReloadDecision(previousRevision, nextRevision, mode)
// 首次 / 关闭 / revision 未变 → 'ignore'
// 变化 + mode === 'browse'      → 'reload'
// 变化 + mode !== 'browse'      → 'defer'  （置 reloadPending，工具栏高亮，回到 browse 时补刷新）
```

- 轮询 900ms；`previousRevision` 用 ref 保存；初始响应只记录基线。
- `'reload'` 时 debounce 120ms 调 `carrierRef.current.reload()`；`loaded` 回调已有 `restoreRuntime()`，无需另写恢复逻辑。
- 自己的写操作完成（打开文件、切版本、切分支）后主动刷新，不等轮询。
- 面板关闭后轮询继续（页面仍要热更新）。

### 测试钩子

`scripts/build-client.mjs` 的 factory 尾部导出一个只读测试口：

```js
exports.__test = { NudgeWorkspacePanel: NudgeWorkspacePanel, hotReloadDecision: hotReloadDecision, gitStoreTestHelpers: { ... } }
```

仅用于 `test/workspace-panel.test.mjs`，不影响 DSH 对 `name / inject / apply` 的读取。

## 6. 测试计划（已实现）

| 文件 | Owner | 覆盖 |
| --- | --- | --- |
| `test/workspace-domain.test.mjs`（新，235 assertions） | host-dev | 真 git 仓库：识别/分支/脏文件/日志/提交/切分支（dirty/stash）/恢复文件/read-only 拒绝；静态服务器 MIME、目录穿越/点文件/符号链接拒绝；watcher revision 递增；`previewStop` 后进程可退出；`sourceRoot` 为仓库子目录（`sourceSubdir`）的完整映射用例 |
| `test/workspace-panel.test.mjs`（新，99 checks） | client-dev | fake hook runtime + fake remote：文件列表渲染与打开、分支列表、dirty 切换两种路径、提交选文件/空消息、恢复版本两步确认、`hotReloadDecision` 三分支 |
| `test/client-smoke.mjs`（40 checks） | client-dev | 新增工具栏/面板相关注册、`exports.__test`、locale 与 bundle 完整性 |
| `test/host-integration.test.mjs`（47 checks） | host-dev | typert invocation 数更新为 14（6 现有含 config/configUpdate + 8 新） |
| `test/workspace-e2e.test.mjs`（新，58 checks） | lead | 真实 `apply(ctx)` + 真 git 仓库 + HTTP 拉取预览页 + 改文件后 revision 变化 + 提交后 `git log` 校验 |

验收结果：`npm run typecheck` 通过、`npm run build` 产出四个 `lib/*.js`、`npm test` 全绿（含真实 Chromium CDP 用例）；`lib/workspace.js` 由 `lib/index.js` 通过 `./workspace.js` 引用。

实现备注：

- 仓库探测按 `git rev-parse --show-toplevel` 依次从 `sourceRoot`、cwd 向上探，覆盖 `sourceRoot` 为仓库子目录（`sourceSubdir`）、仓库在 `sourceRoot` 内（`relativeRoot`）与两者相同三种情况；`sourceRoot` 自身不在任何仓库、只在它内部嵌套独立子仓库的情况不做 `.git` 递归扫描（契约未定义歧义选择规则，面板显示仓库不可用）。
- watcher 的 stat 轮询兜底已实现，但没有故障注入测试（macOS 上递归 `fs.watch` 可用）。

## 7. 不做的事（本轮）

- 不实现 push / pull / merge / rebase / reset --hard / clean。
- 不做 per-file diff 查看器；版本列表只显示 commit 摘要，恢复时整文件覆盖。
- 不注入 live-reload `<script>`（由 Client 轮询 + webview reload 完成，兼容外部 dev server）。
- 不新增 Host Config 字段（沿用 sourceRoot / urlRoot / maxScanFiles / maxFileBytes）。
