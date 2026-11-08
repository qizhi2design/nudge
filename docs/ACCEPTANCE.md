# Nudge · 当前验收记录

> 目的：记录当前 Codex 风格骨架（标注 / 编辑）、设置页与工作区版本面板的验收状态。旧的右侧属性 Dock、标注列表、三段式模式已移除。
> 复跑：`npm run build` 后执行下列测试（或按半区跑 `npm run build:runtime` / `build:host` / `build:client`）。
> 真实 Chromium 的 CDP 集成与 Light / Dark 截图验收在同级 `../validation/` 仓库运行（`node runtime-cdp.mjs` / `node theme-cdp.mjs`），
> 其产物写入本仓库 `docs/evidence/`。

## 1. 自动化验证

| 测试 | 结果 |
| --- | --- |
| `node test/runtime-smoke.mjs` | 257 checks / 0 failures |
| `node test/client-smoke.mjs` | ok / 53 checks |
| `node test/client-theme.test.mjs` | 36 checks / 0 failures（body token / 深色翻转 / 系统兜底 / store 通知 / 组件渲染） |
| `node test/settings-page.test.mjs` | 42 checks / 0 failures（设置 → 轻推：语言 / 功能开关 / 右键菜单 / 关于与更新 / 只读） |
| `node test/workspace-panel.test.mjs` | 99 checks / 0 failures（文件 / 分支 / 提交 / 恢复 + hotReloadDecision） |
| `node test/clip-annotations.test.mjs` | 39 checks / 0 failures |
| `node test/source-sync.test.mjs` | 23 groups / 125 assertions ok |
| `node test/workspace-domain.test.mjs` | 235 assertions / 0 failures（真实临时 git 仓库 + 真实静态服务器 + watcher） |
| `node test/host-integration.test.mjs` | 65 checks / 0 failures（含产品偏好 config / configUpdate 与 about 版本桥） |
| `node test/workspace-e2e.test.mjs` | 58 checks / 0 failures（真实 Host 插件 + 真实 git 仓库 + HTTP 预览 + 热更新 revision） |

## 2. 标注验收

- 工具栏只有一个一级「标注」toggle，可再次点击退出。
- 悬停元素显示 2px `#0069FB` 选择框、3% 填充、内白描边、元素 metadata。
- 点击元素 → 24px Composer 胶囊（滑杆 / 输入 / 关闭 / 圆形提交；表面颜色跟随宿主 Light / Dark）。
- 拖拽空白区域 → 虚线区域框 + Composer。
- 拖选文字 → 蓝色文字选区 + 编号 pin + Composer；保存后写入 `textSelection`。
- 保存后：
  - 页面只保留编号 pin / 文字高亮，**不再显示页面左下角浮动评论卡**（编辑 / 删除通过点 pin、再次点击已标注元素，或对话框 clip 卡片完成）；
  - 页面底部出现 Codex 风格「正在批注 · N」浮条：六点拖拽手柄（可拖动、自动夹在视口内）+ 定位最新批注 + 隐藏 / 显示标记 + 丢弃批注（两步确认）+ 蓝色「发送」+「×」退出。
- 浮条动作验收：隐藏标记后 pin / 区域一起隐藏、浮条保留；再次点击恢复；丢弃批注需要连续两次点击才会清空。
- 按住 Space 临时交还页面；Esc 退出接管。
- 标注保存、编辑、删除都走同一套 runtime → Client 事件链路。

## 2.1 Clip 批注插入对话框

- 点击浮条「发送」→ 当前页面的标注（含元素截图缩略图）与已生效的视觉修改一起进入对话框：
  - 输入框上方浮出 clip 卡片（颜色跟随宿主 Light / Dark）：缩略图、元素标签、意见文本、编辑 / 删除；
  - 输入框内顶部出现「💬 N 条注释 ×」计数 chip；`×` 清空全部 clip；
  - 页面侧 pin 在插入后清除，避免两边重复。
- 卡片支持：点击 chip 展开 / 收起；铅笔就地编辑意见（保存 / 取消、⌘/Ctrl+Enter 保存）；垃圾桶移除单条；「视觉修改」行可单独移除。
- 输入框在有 clip 时自动预留 chip 行高度；清空 clip 后恢复原始高度。
- 发送（Enter / 发送按钮）时，clip 的上下文（页面 URL、selector、文本、意见、截图路径、已生效视觉修改）自动追加到用户消息之后交给 Agent；发送成功后卡片清空，发送失败/异常则完整恢复。
- 斜杠命令（`/...`）不会被追加 clip 上下文，卡片保留。

- 已标注的元素再次点击时直接打开原批注编辑（预填原意见），不会重复新建；pin 点击同样进入编辑。

## 2.2 Codex 对照

- 参考交互来自 Codex 桌面端 composer 的 `commentAttachments`（`commentAttachments.numAnnotations` = “N 条注释”、`composer.annotationEditor.title` = “编辑注释”）。
- 本插件在 DSH composer 的 `conversation.input.overlay` slot 内复现：卡片浮在输入框上方，计数 chip 位于输入框顶部。

## 2.3 Light / Dark 主题自适应

- 宿主工具栏、DOM 树侧栏、clip 卡片等宿主 UI 从 `<body>` 读取 DSH `--dsw-alias-*` token；DSH 切换 Light / Dark 时通过 `theme/change` + body 属性监听即时重渲染，不刷新页面。
- Client 把 `themePaletteForRuntime(theme)`（`accent` / `panelBg` / `text` / `border` / `muted` / `danger` / `isDark`）用 `setTheme(...)` 推给注入的页面运行时，注入层按 `isDark` 在 `OVERLAY_DARK` / `OVERLAY_LIGHT` 之间切换。
- Light：Composer / 悬浮样式卡为 `#ffffff` 表面 + `#0f1115` 文字，底部批注条 `#ffffff`，占位文字 `rgba(15,17,21,0.50)`；metadata 浮层复用宿主 palette（`#ffffff` 表面 / `#0f1115` 文字）；页面上不再残留 `#2f2f2f` 深色表面。
- Dark：Composer / 样式卡为 `#2f2f2f`，底部批注条 `#262626`，文字 `#f5f5f5`，占位文字 `rgba(255,255,255,0.42)`；metadata 浮层复用宿主 palette（`#2c2c2e` 表面 / `#f9fafb` 文字）；Dark 覆盖层数值与改造前逐字节一致。
- 标注 / 编辑过程中翻转主题：已打开的 Composer、已建好的底部批注条、pin 与 metadata 浮层都会就地重绘；内联样式的悬浮样式卡关闭后按新主题重建。
- 无 DSH token 时按 `prefers-color-scheme`（及 `body[data-ds-dark-theme]`）选择 fallback palette。
- 证据：`docs/evidence/21-theme-light.png`（Light：白色底部条 + 白色 metadata 浮层 + 编号 pin）与 `docs/evidence/22-theme-dark.png`（Dark：`#262626` 底部条 + `#2c2c2e` metadata 浮层 + 编号 pin）。

## 3. 标注持久化说明

- clip 草稿保存在 Client 内（按 Session 维度，内存态）；插件热重载或页面刷新会清空。

## 4. 编辑验收

- 工具栏「编辑」toggle 进入编辑（标注 Composer 不再提供样式入口）。
- 点击元素 → 22px 悬浮样式卡（表面颜色跟随宿主 Light / Dark）；页面保持满宽，无右侧 Dock。
- 卡片为可折叠分组：默认展开「文本内容 + 文字样式」（常用场景就是改文字），其余折叠：布局、间距、外观、高级。点分组标题展开 / 收起。元素没有直接文本节点时，文本内容分组整体不渲染。
- 文本内容只改元素的直接文本节点（保留子元素结构）；属性编辑走 `design-text` / `design-attr` 事件，与样式共用撤销栈与源码同步队列。
- 工具栏「DOM 树」开关 → 页面右侧 DOM 侧边栏：懒加载树、当前选中高亮且祖先自动展开；点节点即选中该元素、滚动到可视区并闪烁（编辑模式下同时打开样式卡）。
- 内容编辑只改元素的直接文本节点（保留子元素结构），属性编辑会进入 `design-text` / `design-attr` 事件，与样式共用撤销栈与源码同步队列。
- 取消回滚本次卡片修改；圆形 ✓ 保留；Esc 等同取消。
- 设计改动以 `design-style` 事件回传 Client，进入历史与源码同步队列。
- 撤销 / 重做仍在工具栏可用。

## 5. 工作区版本与热更新验收

> 契约与接口细节见 [workspace-versions.md](workspace-versions.md)。本轮没有新的截图证据，验证由真实 git 仓库 / 真实 HTTP 服务器 / 真实 Host 插件的自动化用例覆盖。

- **文件**：面板列出 `sourceRoot`（默认会话 cwd）内 `.html/.htm` 文件（跳过 `node_modules/.git/dist/...` 与点目录，受 `maxScanFiles` 预算约束并报告截断）；点文件调用 `previewOpen`，Host 为每个 root 启动 `127.0.0.1:listen(0)` 静态服务器并返回 URL，webview 打开后同一 root 复用端口。
- **静态服务器**：GET/HEAD、MIME 表、`Cache-Control: no-store`、`/` 与目录回落到 `index.html`；拒绝编码后的目录穿越、符号链接逃逸、点文件、`.git`、`node_modules`；`previewStop` 关闭端口后可继续读 Git / 扫描。
- **版本**：`workspace()` 返回分支 / detached / 本地分支白名单 / 脏文件（modified / added / deleted / renamed / untracked / conflicted，重命名带原路径）/ HTML 扫描；`gitLog(file)` 返回最近 40 条（file 省略时为仓库历史）。`git.changes` 只包含 `sourceRoot` 内的文件，路径统一相对 `sourceRoot`；`sourceRoot` 为仓库子目录时返回 `sourceSubdir` 并正确换算（235 条 domain 断言覆盖）。
- **切分支**：干净工作区直接 `git switch`；脏工作区返回 `{ ok:false, reason:'dirty', git }`，面板提供「暂存并切换」（`git stash push --include-untracked`）或「先去提交」，不会静默丢弃改动；已在目标分支时幂等返回。不存在 / 非本地分支被拒绝。
- **恢复版本**：`gitRestoreFile(file, commit)` 校验 commit 与路径后执行 `git checkout <commit> -- <file>`，只改工作区 + 索引、不动分支指针；文件在目标 commit 不存在时明确报错。
- **提交**：`gitCommit(message, files)` 只接受当前 `changes` 里的路径（否则拒绝），`files` 省略时 `git add -A`；空 message 拒绝，超 4000 字符截断；无改动返回 `{ committed:false, reason:'nothing-to-commit' }`；hook 失败原样回传 stderr 摘要。面板默认全选、支持部分勾选。
- **只读策略**：`read-only` 下扫描 / 历史 / 预览 / 轮询可用；切分支、恢复、提交被 Host 拒绝并显示原因。
- **热更新**：Host watcher（`fs.watch` recursive + 120ms debounce，revision 单调递增，最近 8 条变更路径；1s stat 快照兜底）→ Client 约 900ms 轮询 `watchPoll`；`hotReloadDecision` 在浏览模式 `reload`、标注 / 编辑模式 `defer`（提示 + `reloadPending`，回到浏览立即刷新）；工具栏刷新图标可关闭自动刷新。插件写盘、用户手改、Agent/AI 编辑都触发同一链路。
- **E2E 覆盖**：`workspace → previewOpen → HTTP GET → 改文件 → watchPoll revision 上升 → 再次 GET 拿到新内容 → gitCommit → 真实 git log 校验 → 进入分支 / 脏拒绝 / stash 切换 / 恢复版本 → 只读拒绝 → previewStop 关端口`。

## 6. 响应式工具栏（窄宽度）

- 工具栏按容器宽度分三档：`<720px` 收起点/编辑等按钮的文字标签（图标 + tooltip）；`<620px` 自动分成两行——第一行只保留后退 / 前进 / 刷新 / 地址栏 / 前往，第二行放标注 / 编辑、DOM / 工作区 / 自动刷新、撤销 / 重做 / 外部；`<430px` 再隐藏前进与「前往」（地址栏 Enter 仍可跳转）。
- 分行的原因是右侧边栏经常只有 ~500px：单行放 13 个按钮会把地址栏挤到只剩几十像素；两行后地址栏保持可用宽度，所有功能仍然直接可见（不需要二级菜单，避免 Host DOM 无法覆盖 Electron webview 的问题）。
- 自动刷新待命时，刷新按钮显示 warn 色圆点/待命高亮，两行布局下同样保留。
- 阈值是纯函数 `toolbarLayout(width)`（`src/client/ui/layout.ts`），`client-smoke` 覆盖 wide / narrow / tiny / 未测量四种情况。

## 6.1 设置页（产品偏好）验收

- **入口**：设置 → 左侧「轻推」（排在「项目目录」之后），与其它插件配置页同级。
- **通用**：插件界面语言三档（跟随 DSH / 中文 / English）。选择中文或 English 后轻推自身界面文案立即切换（由 Client 配置 store + 内嵌词典实现），无需重载；DSH 外壳文案仍跟随宿主语言。
- **功能**：标注模式、编辑模式、DOM 树、工作区版本、自动热更新五个开关。
  - 关闭后工具栏入口立即隐藏（`InspectorToolbar` 根据配置 store 过滤按钮）；
  - 若会话正停留在被关闭的模式，自动退回浏览模式；已打开的 DOM / 工作区面板自动关闭；
  - 关闭自动热更新后不再轮询 `watchPoll`，页面不再自动刷新。
- **右键菜单**：链接（含聊天消息内链接）右键菜单与浏览器标签 ⋮ 菜单的「在轻推中打开」可独立关闭；关闭后 `resolve` 返回空数组 / 菜单项不渲染，重新打开立即恢复。
- **关于与更新**：显示版本、构建时间（`lib/*.js` 最新 mtime）、git 分支 / 短提交 / 脏状态、运行环境、插件目录；「检查更新」调用 Host `about(check=true)`，本地 `link:` 开发版如实显示「无法在线检查更新」，插件管理器缺失时也明确报告 unavailable。
- **保存语义**：每次切换即时写入 profile 的 `cordis.patch.yml` 并镜像到 Client store；失败回滚到上一个值并显示错误；「恢复默认」一次写回全部产品默认值；read-only 部署禁用全部控件且不调用 `configUpdate`。

## 7. 视觉截图

| 证据 | 文件 |
| --- | --- |
| 悬停 + metadata | `docs/evidence/15-codex-style-hover.png` |
| 深色 Composer 胶囊 | `docs/evidence/16-codex-style-composer.png` |
| 编号 pin + 选中框 | `docs/evidence/17-codex-style-marker.png` |
| 深色悬浮样式卡 | `docs/evidence/18-codex-style-design.png` |
| 底部批注条（历史截图，评论卡已移除） | `docs/evidence/19-codex-style-comment-tray.png` |
| 文字选择批注 | `docs/evidence/20-codex-style-text-selection.png` |
| Light 主题覆盖层（白色底部条 + metadata + pin） | `docs/evidence/21-theme-light.png` |
| Dark 主题覆盖层（`#262626` 底部条 + `#2c2c2e` metadata + pin） | `docs/evidence/22-theme-dark.png` |
