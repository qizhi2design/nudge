# Nudge · 当前验收记录

> 目的：记录当前 Codex 风格骨架（标注 / 编辑）、设置页与工作区版本面板的验收状态。旧的右侧属性 Dock、标注列表、三段式模式已移除。
> 复跑：`npm run build` 后执行下列测试（或按半区跑 `npm run build:runtime` / `build:host` / `build:client`）。
> 真实 Chromium 的 CDP 集成与 Light / Dark 截图验收在同级 `../validation/` 仓库运行（`node runtime-cdp.mjs` / `node theme-cdp.mjs`），
> 其产物写入本仓库 `docs/evidence/`。

## 1. 自动化验证

| 测试 | 结果 |
| --- | --- |
| `node test/runtime-smoke.mjs` | 280 checks / 0 failures |
| `node test/client-smoke.mjs` | ok / 99 checks |
| `node test/client-theme.test.mjs` | 36 checks / 0 failures（body token / 深色翻转 / 系统兜底 / store 通知 / 组件渲染） |
| `node test/settings-page.test.mjs` | 42 checks / 0 failures（设置 → 轻推：语言 / 功能开关 / 右键菜单 / 关于与更新 / 只读） |
| `node test/workspace-panel.test.mjs` | 99 checks / 0 failures（文件 / 分支 / 提交 / 恢复 + hotReloadDecision） |
| `node test/clip-annotations.test.mjs` | 111 checks / 0 failures（含真实 cordis HMR「僵尸包装」回归：根单例安装 / 稳定 dispatcher / 幂等 / 恢复） |
| `node test/source-sync.test.mjs` | 23 groups / 125 assertions ok |
| `node test/workspace-domain.test.mjs` | 235 assertions / 0 failures（真实临时 git 仓库 + 真实静态服务器 + watcher） |
| `node test/host-integration.test.mjs` | 65 checks / 0 failures（含产品偏好 config / configUpdate 与 about 版本桥） |
| `node test/workspace-e2e.test.mjs` | 58 checks / 0 failures（真实 Host 插件 + 真实 git 仓库 + HTTP 预览 + 热更新 revision） |
| `node test/host-bar-parity.test.mjs` | 30 checks / 0 failures（宿主浮条 vs 页面浮条：调色板 / Lucide 图标几何 / 48px 胶囊与控件尺寸逐项一致，防止克隆漂移改掉外观） |
| `node test/floating-composer.test.mjs` | 72 checks / 0 failures（全屏底部对话：语义标记 / 贴底输入框 / 点输入框展开消息（含标注模式）/ 两种形态均可收缩为悬浮按钮 / 悬浮按钮恢复 / 宿主标注浮条（显隐 / 计数 / 拖动 / 动作转发 / 两段丢弃）/ 页面失焦收起 / 页面底部安全区发布 / 会话隔离 / owner 隔离） |

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

## 2.4 Space（临时操作页面）边界验收

- Space 的“按住临时操作页面”在标注与编辑两种模式下是**同一套逻辑**，不是两套快捷键，因此不存在模式之间的组合冲突。
- 工具栏按钮（含标注 / 编辑 toggle）在**鼠标点击**时不抢键盘焦点（`onMouseDown` preventDefault），所以点击模式按钮后按 Space 不会再次触发该按钮、把模式关掉；键盘 Tab 聚焦按钮时 Space 仍是正常按钮激活。
- 编辑模式样式卡打开时，Space 不再触发页面 passthrough（`!designCard && !isOverlayEvent` 守卫）；焦点在样式卡输入框内时 Space 正常输入空格，焦点在卡片按钮上时 Space 正常激活按钮。
- 标注 composer 打开时 Space 始终作为输入字符（沿用 `!popover` 守卫）。
- 页面 passthrough 只在焦点位于被检查页面、且无浮层输入目标时生效；`Esc` 仍可退出接管。
- 回归用例：`runtime-smoke` 新增“样式卡打开时 Space 不 passthrough / 样式卡输入内 Space 不 passthrough”两项；真实 DSH Web Client 里点击编辑后按 Space，模式保持不变（此前会被 `编辑` 按钮的点击重新触发并退出编辑）。

## 3. 标注持久化说明

- clip 草稿保存在 Client 内（按 Session 维度，内存态）：页面刷新会清空；插件热重载（HMR）**不会**清空——草稿与发送 dispatcher 挂在页面级共享状态上，新旧模块实例读写同一份记录。
- **随消息发送**：`conversation` 是插件根上下文可见的 **root 单例**（整个 asar 唯一 provider，Session scope 只是 `fiber.ctx.extend`、没有 isolate），因此根级 `ctx.inject(['conversation'])` 会触发并在启动时给唯一的 `conversation.sendSession` 安装一次包装；`sessions.scope(sessionId).get('conversation')` 解析到同一个 raw 实例，作为卡片出现后的幂等保险再校验 / 安装一次。发送时把「标注 + 已实时生效的视觉修改」的结构化上下文拼到用户消息后；Host 接受后才清空卡片并标记 op 已消费，拒绝 / 异常则把卡片恢复。
  - 包装是**稳定 dispatcher**：`sendSession` 上只保留一层包装（`__dshnudgeClipSend` + `__dshnudgeClipStable` 自有属性），真正实现每次调用都从页面级共享状态读取最新模块实例发布的 dispatcher；因此 HMR 后旧包装也能执行新代码。
  - 若检测到无法识别的旧包装（HMR 前那版用 Proxy 恒等比较做 restore，永远卸载不掉的「僵尸包装」），会在它外面再包一层稳定包装（旧包装仅作安全 inner），保证热重载当场恢复、无需刷新页面。
  - 插件卸载时只恢复 / 删除自己安装的包装（`delete raw.sendSession` 让原型方法重新可见），并清掉自己发布的共享 dispatcher；若消息文本里已经带 `【Visual Inspector · 网页标注与视觉修改】` 段落（例如调用方自行插入），不重复追加。

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

## 6. 双行工具栏

- 工具栏固定上下两行：第一行是原生浏览器栏（后退 / 前进 / 刷新 / 地址栏 / 前往，38px）；第二行是轻推操作栏（34px），按左右两组摆放：左组是模式与面板开关（标注 / 编辑、DOM / 工作区 / 自动刷新），右组是历史与出口（撤销 / 重做 / 在系统浏览器打开 / 快捷键表），中间弹性留白——全屏超宽时不会出现一边挤成一撮、另一边一大段空白。右侧边栏不再出现「所有按钮挤在一行」的形态。
- 两行使用同一套 DSH 工具栏 Token：`--dsw-alias-bg-base` 背景、`.5px` 分隔线、28px 按钮、`--dsw-radius-sm` 圆角；地址栏聚焦时使用 business 色描边。
- `<460px` 时第二行的标注 / 编辑标签收成图标（tooltip 仍有完整说明）；`<430px` 再隐藏前进与「前往」（地址栏 Enter 仍可跳转）。
- 自动刷新待命时，刷新按钮显示 warn 色圆点/待命高亮，两行布局下同样保留。
- 操作栏最右侧的键盘按钮展开 / 收起「轻推快捷键」表：表内列出当前生效键位（含只读的 Space 行），不覆盖 webview，而是把工具栏撑高一行；Esc 或再次点按钮收起。
- **不再**在工具栏下方常驻通知条；改为 hover 标注 / 编辑按钮时弹出交互 tooltip：点击 / 拖拽说明 + 「按住 `Space` 临时操作网页」（`Space` 用 lucide 键帽），并附带该开关的当前生效键位。tooltip 在模式内 / 模式外都可 hover 查看。
- 阈值是纯函数 `toolbarLayout(width)`（`src/client/ui/layout.ts`），`client-smoke` 覆盖 wide / sidebar / compact / tiny / 未测量五种情况。

## 6.2 快捷键（系统注册 + lucide 键帽）验收

- **注册**：轻推通过 `ctx.inject(['shortcuts'])` 注册 5 个可编辑命令（`nudge.open` / `nudge.annotate.toggle` / `nudge.edit.toggle` / `nudge.dom.toggle` / `nudge.workspace.toggle`）和 3 个只读 fixed 行（`nudge.fixed.space` / `nudge.fixed.escape` / `nudge.fixed.shiftTab`），命令随后出现在 DSH「设置 → 快捷键」中，可录制 / 改键 / 恢复默认。
- **默认键位**：标注切换默认 `primary+shift+Period`（即参考实现的 `CmdOrCtrl+Shift+.`）；其余为 `primary+shift` + `I/E/D/G`，覆盖 `desktop:macos/windows/linux` 与 `web:macos/windows`（web:linux 不注册，符合 shortcut 服务的 Web 限制）。
- **路由**：命令解析当前聚焦的右侧边栏 target；聚焦的轻推 Tab 有已挂载 body 时直接派发给 tab 命令总线；没有时聚焦同会话已有轻推 Tab，或按目标 pane 打开新 Tab（带 `params.mode` / 浏览器 URL），面板命令在 body 注册后由待处理队列补发；`isTargetCurrent` 会拒绝过期的 target。
- **可用性**：功能开关关闭时命令返回 blocked（`shortcut.featureOff`）；没有会话 / target 时返回 `shortcut.noSession`；register 单条失败被隔离，不影响其它命令。
- **键帽**：`keycapModel(binding, platform)` 是纯函数（`client-smoke` 覆盖 macOS `⌘/⇧`、Windows `Ctrl/⇧`、Space 图标与字母/标点映射）；tooltip、快捷键表共用 `ShortcutKeys`。
- **无覆盖**：快捷键表是工具栏内布局行；交互提示是宿主自绘的 fixed tooltip 卡片（`data-tooltip-card`），优先绘制在 toolbar 上方，不覆盖 `<webview>`。`data-shortcut-sheet` / `data-mode-hint-content` / `data-tooltip-card` 作为 DOM 契约供验收断言。
- **真实壳验证**：在 DSH Web Client（同一套 shell + 同一 Client bundle）里 hover 标注按钮，`data-tooltip-card` 定位在 toolbar 上方、文案与 Space 键帽完整可见；此前 Radix popper 的方案在该壳里 wrapper 停在 `translate(0,-200%)`（`isPositioned=false`），tooltip 实际渲染到视口外，这是“重启后仍看不到”的根因。
- **主题适配**：`TooltipProvider` 接收 `InspectorTheme`，Light 主题卡片 `background = #e9ecf2`（`--dsw-alias-bg-overlay`）、文字 `#0f1115`；Dark 主题卡片 `background = #2c2c2e`（`--dsw-alias-tooltip-bg`）、文字浅色；边框 / 阴影 / keycap 同步跟随 DSH token。Light / Dark 截图预览见 `docs/evidence/23` / `24`。
- **验证**：`node test/client-smoke.mjs` 断言注册 id 顺序、默认键位、fixed 行、三条 resolve 分支（feature gate / no session / live dispatch）、新 Tab 打开与队列补发、键帽模型；`npx tsc --noEmit` 通过。

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

## 6.3 全屏底部对话验收（待实机）

- **触发**：打开轻推 Tab → 点右侧面板「全屏」。原生输入框贴视口底部居中（收起宽约 760px）；点击、聚焦或直接在输入框输入，消息区就在它上方展开为底部停靠面板（宽约 880px、高约 70%），没有悬浮窗标题栏 / 阴影 / 关闭按钮——标注模式下同样可通过点击或聚焦输入框展开历史。点页面、面板外或焦点回到网页后，消息区收回，只留输入框。
- **收缩为悬浮按钮**：输入条形态和展开形态都有收缩控制——展开时在面板右上角（chevron），收起时浮在输入条右上方；点击后整块面板收成右下角 46px 圆形对话按钮，再点恢复展开。收缩按钮是宿主层 fixed 控件（层级高于面板与输入条），两种形态下都可见可点；输入条与悬浮按钮互斥。
- **标注浮条由宿主层承载（外观不变）**：全屏时页面在 webview 里、输入框在宿主层，页面自带的「正在批注」浮条既盖不过输入框，也无法拖到输入框所在区域。因此全屏且处于标注模式时：页面 runtime 隐藏自带浮条（`setBarHosted(true)`），由宿主渲染**与页面逐像素一致**的同款浮条（`data-dsh-nudge-float-annotbar`：48px 高 / 14px 圆角 / 同样的 `bgStrong`、边框、阴影、12.5px 字体、6px 8px 6px 6px 内边距、22×30 拖拽柄、28×28 图标按钮、30px 发送按钮与 8px 间距；图标使用与 runtime 相同的 Lucide 路径 15px / stroke 2；颜色取自 runtime 的 OVERLAY_LIGHT/DARK，并跟随 `theme.isDark` 重绘；armed 丢弃用 `theme.danger`，与页面一致）。唯一区别是图层与坐标：它 fixed、z-index 高于输入条与页面，可拖到窗口任意位置；按钮动作经 carrier 转发给页面 runtime：定位最新批注 / 切换标记显隐 / 两段式丢弃 / 发送（等价 runtime 的 `annotation-send`）/ 退出标注；计数与标记状态从 `getBarState()` 同步。默认位置与原先安全区抬升一致：输入条上方居中、间距 8px；离开标注或退出全屏后移除宿主浮条并恢复页面自带浮条。
- **页面铺满 + 底部安全区**：全屏时网页容器在所有模式下都铺满到底部，不再缩短页面（否则底部会露出面板背后的会话栏）。输入条收起时占用页面底部一条，Client 通过 `carrier.setBottomInset()` 把它的高度发布给页面 runtime；页面内的「正在批注」浮条、标注浮层、样式卡统一以该安全区为下界定位（`positionPopover` / `positionDesignCard` / `applyBarPosition`），因此始终停在宿主输入框上方，不会被盖住或裁掉，浮条仍可自由拖动。进入标注模式时面板先收成输入条以避免遮挡页面拖拽区，之后点输入框仍可展开历史；展开时安全区归 0，浮条会回到页面底部（被展开面板挡住），收回到输入条后重新抬起。
- **不触发**：普通分栏、其他插件 Tab 的全屏、轻推 Tab 在浮动面板中（`panel.isFloating`）、轻推 Tab 不可见，以及「设置 → 轻推 → 功能 → 全屏悬浮输入框」关闭时，对话列保持原布局。
- **复用真实输入框**：紧凑态与展开态都用宿主原生 composer（草稿、附件、权限、模型菜单、发送路径与普通分栏一致），不复制编辑器、不转发键盘事件；关闭全屏后草稿仍在。
- **退出还原**：点「退出全屏」、关闭面板、切换会话 / Tab 或禁用开关后，`data-dsh-nudge-floating-chat` / `data-dsh-nudge-float-mode` / `--dsh-nudge-float-compact-height` 全部移除，对话回到分栏原位置。
- **共存**：已安装 `@yfwu2020/dsh-full-view` 等会标记 `[data-dsh-floating-chat]` 的插件时，轻推自动让位，不叠加两套悬浮布局。
- **边界**：宿主替换 `data-rightbar-col` / `data-conversation-session` / `data-composer-seat` 等语义标记时需要同步适配；当前按 DSH 0.2.2-rc.1 的 `dsh-client-ui-layout` / `dsh-client-ui-sidebar-right` / `dsh-client-ui-conversation` 标记实现。

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
| 快捷键组件预览（真实组件 + DSH dark token 的 harness 渲染，非运行中应用截图） | `docs/evidence/23-shortcut-sheet-dark.png` |
| 快捷键组件预览（Light token） | `docs/evidence/24-shortcut-sheet-light.png` |
