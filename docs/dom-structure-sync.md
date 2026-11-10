# DOM 结构编辑回写源码：现状诊断与技术方案

> 对象：`dsh.nudge` 编辑模式里的**结构操作** —— 删除元素（样式卡 🗑 / `Delete` / `Backspace`）与拖动元素（重排 / 改父级）。
> 范围：为什么这类修改「看起来生效了但源码没变 / 变了但变错 / 刷新后行为与提示相反」，以及把它做成可信能力的完整技术方案。
> 证据基线：`plugin/lib/*.js`（2026-11-10 构建）+ 真实 Chromium CDP 复现 + 27 组 Host 探针。行号对应当前 `src/`。
> 文末「附录 C」给出证据索引；`docs/source-sync.md` 是**样式/文本/属性**链路的既有契约，本文不重复其内容，只指出它关于结构编辑的缺口。

> **阅读状态说明（2026-11-10）**：§1–§4 是**修复前的诊断基线**，实测证据按原样保留；其中「结构操作无法撤销」「刷新页面可恢复 DOM」「`'undone'` 是死代码」等描述都指**修复前**行为。§0.1 与 §5–§13 是本轮方案与落地结果，§10 的 P0 已全部完成，验证结果见 §14。

---
---

## 0. 结论先行（TL;DR）

1. **不是「没实现回写」**。`html-remove` / `html-move` 两种 Host 策略、事务化批量写入、`protected-element` / `invalid-move-target` 等拒绝条件都已实现，且有单测（`test/source-sync.test.mjs:740-878`）。
2. **回写只在「理想页面」成立**：元素必须以字面标记存在于被映射的源码文件里，且能被启发式锚点唯一定位。一旦不满足，就静默降级为 `preview`（页内生效、不写盘），而 UI 把这种降级表达得非常弱。
3. 你的场景（Workspace 静态 HTML + 预览服务器）踩中的是三个**确定性缺陷**：
   - **F1**：`data-source` hint 被当作「文件路由」直接采信；hint 指向的文件里找不到元素时**不会**回退到 URL 映射或搜索。demo 页的营销卡片就是这种形状（标记在 `demo/index.html:92`，hint 却指向 `demo/app.js:18`）→ 实测 `preview / unresolved-element / demo/app.js`。
   - **F3**：结构操作采集了元素文本（`textSnippet`），但**从未把它接成定位器需要的 `textBefore`**，定位阶梯因此少一级最强锚点。
   - **F8**：一条批次里只要有一条写成功，状态就聚合为「已同步」，把同一批里「仅预览」的结构编辑**洗白**——这正好解释「提示说已同步，文件却没变」。
4. 另有两个**数据损坏级 bug**必须先修：**F4** 删除/移动命中 `.js/.tsx` 时用 HTML 分词器硬剪，会把 `{cond && <p/>}` 剪成 `{cond && }` 并报 `synced`；**F5** 截断的 `outerHTML` 让 DOM path 校验退化成 60 字符文本前缀，可能删掉**同标签的另一个元素**也报 `synced`。
5. 会话一致性也不成立：**F9** 「刷新页面可恢复 DOM」是假话（刷新会重放 remove/move）；**F10** 重放忽略撤销位置（`'undone'` 是死代码）；结构操作**无法撤销**（`body.tsx:823-832`）——这正是你截图里那条提示的来源。更严重的是重放**不幂等**，已实测：源码写入「删掉第 1 张卡片」后，每次 reload + reapply 会把**下一张**卡片也删掉（§3.2）。
6. 方案分三层：**Anchor v2（确定性锚点）→ 定位/补丁引擎（多候选 + 安全闸门）→ 会话一致性（服务端句柄 + revision + 幂等 + 逆操作）**，外加「逐条状态反馈」这一层。P0 可在 1–2 天内把「删除/拖动回写」从概率事件变成确定性事件；P1/P2 补齐撤销、更多结构操作与框架感知。

---

## 0.1 本轮已实现（2026-11-10）

诊断里的 P0 已全部落到代码（不是只写方案）：

| 层 | 改动 | 关键文件 |
| --- | --- | --- |
| Runtime | 结构 payload 升级为 Anchor v1.5：`textBefore`（2048，全量）、`outerHTML` 64KiB 全量 + `outerHTMLTruncated` 标记（不再拼 `…`）、`elementKey`（`el_<n>`，WeakMap，无 DOM 属性）；remove 增 `parentSelector`/`beforeSelector`，move 增 `fromParentSelector`/`fromBeforeSelector`；新增 `applyInsert` / `applyMoveElement` 两个 throw-free API | `src/runtime/domains/design/10-card.ts`、`editing/10-apply.ts`、`lifecycle/20-api.ts` |
| Client | 结构 wire 契约补齐（含 `targetParentPath`/`beforePath` 不再被丢）、按 opId 不合并、状态机新增 `partial`（「已写入 N / 未写入 M：原因」）且 **done 不再洗白 preview**、错误/部分/预览提示不再 2.6s 自动消失、replay 只重放「未撤销 + 未落盘 + 同 URL + history.index 之前」、结构撤销/重做（remove→insert、move→反向 move）并同步回写源码、`tab.handles` 缓存服务端句柄、结构 reason 全量本地化 | `src/client/domains/persistence/sync-queue.ts`、`inspector/body.tsx`、`carrier/carrier.ts`、`platform/{store,history}.ts`、`locale/*.json` |
| Host | 路由改为**候选集**（hint → URL 映射 → 搜索，hint/映射文件定位失败不再终止）；定位器支持 `textSnippet` 文本锚点与**服务端句柄**优先；截断 payload 的 path 校验改为严格要求（开标签属性签名 + 全文相等）；结构编辑只允许 html/htm/vue/svelte/astro（JS/JSX 返回 `unsupported-js-source`，不再剪坏）；move 目标/锚点支持 DOM path 与纯 selector 兜底；新增 `insert` 策略（remove 的逆操作）与写回后的 `handle` 签发；preview 返回 `candidates` 诊断 | `src/host/domains/persistence/{index,html/locate,edits/markup,planning/validate,constants}.ts`、`html/digest.ts`（新增） |

**行为变化（用户可感知）**

- 静态 HTML 的删除/拖动现在会真正写回源码；`data-source` hint 指向错文件时不再吞掉编辑。
- JS 渲染节点、SPA 外壳页里不存在于源码的元素：仍只预览，但提示条会给出具体原因与候选文件，不再谎报「已同步」。
- 删除/移动可以撤销，撤销会同时写回源码；刷新不再重复应用已落盘的结构修改（修掉「刷新一次少一张卡片」的实测 bug）。
- `.js/.jsx/.ts/.tsx` 上的结构编辑从「可能剪坏文件」改为「明确拒绝 + 提示」，文本/属性编辑不受影响。
- Host 通过 `ping` 广播能力集（`structure-v1` / `insert` / `handle` / `candidates`），Client 据此识别「页面已是新版、DSH 进程里还是旧版 Host」的混搭状态：此时撤销删除所需要的 `insert` 编辑会被旧 Host 以 `unsupported-edit-kind` 拒绝，界面改为提示「界面与 Host 版本不一致，请完全退出并重开 DSH」，而不是显示原始 reason code。

**仍未做（见 §10 P1/P2）**：兄弟差分锚点与 `normalizeMarkup`、跨文件 move、完整的 `insert/duplicate/wrap/unwrap` 命令面板、框架 source-map 感知、sidecar 运行时覆盖。

### 关于「给每个元素绑 id」这个想法

结论：**不要往页面/源码里写 id，但要给元素一个稳定身份** —— 本轮的实现正是后者：

- **往 DOM 里加 `data-nudge-id` 没用**：它只存在于运行时，源码里没有，定位器仍然要靠启发式去源码里找元素；而且它与框架的 re-render / hydration 冲突（React 会丢弃未声明的属性，SSR 可能 hydration mismatch）。
- **往源码里写 `id="…"` 是破坏性的**：会改变 `#id` 选择器语义与 CSS 优先级、影响 a11y/测试选择器、污染用户源码；给每个元素都写 id 更是不可接受；即使只给「编辑过的元素」写，也会在每次首次编辑时产生一次源码改写，且删除元素时 id 也随之消失。
- **正确做法（已实现）**：运行时用 `WeakMap` 给元素一个会话内的 `elementKey`（不写 DOM），Host 在每次成功写盘后签发 `handle { openStart, line, tag, openTagDigest }`，Client 按 selector 缓存并在下一次编辑时带回。这样「同一元素的下一次操作」是 O(1) 精确命中，不需要 id，也不污染源码；框架重渲染后 `elementKey` 失效只会退化为普通锚点定位，不会写错文件。
- 如果将来确实需要跨会话的稳定标识，正确形态是 **sidecar 清单**（`.dsh/nudge-overlays.json` 记录「页面 + 元素路径 + 操作」），而不是把 id 写进用户的 HTML。

---

## 1. 先把三个被混在一起的现象拆开

用户的一句话里其实混着四类问题，修复路径完全不同：

| # | 现象 | 用户话术 | 真实原因 | 归类 |
| --- | --- | --- | --- | --- |
| A | 源码文件完全没变 | 「删除/修改 DOM 不回写」 | 定位失败降级 `preview`（F1/F2/F3/F5/F6/F7/F12） | 定位/路由 |
| B | 文件变了，但内容不对 | 「回写了，但改坏了」 | 命中 JS/JSX 硬剪（F4）；或删错同标签元素（F5）；或落到同名模板（E13） | 补丁安全 |
| C | 提示「已同步」，文件却没变 | 「它说写成功了」 | 混合批次状态聚合（F8）；或写到 `files` 里的另一个文件 | 状态上报 |
| D | 刷新后元素又回来 / 又少一个；不能撤销 | 「刷新页面可恢复 DOM」 | 重放语义（F9/F10/F11）+ 结构操作无逆操作 | 会话一致性 |

**同一个页面可以同时命中 A/B/C/D。** 你截图里出现的 `移除 / 移动元素无法在页内撤销；刷新页面可恢复 DOM。` 属于 D：它证明结构操作被有意排除在撤销之外，而这句文案本身是错的（见 §4.6）。

---

## 2. 现状链路（代码地图）

```
① 触发                     ② 事件                    ③ Client                   ④ Host                        ⑤ 写盘
design card 🗑              design-structure          handleRuntimeEvents        sync(session,page,edits)      fs.writeText(
Delete/Backspace    ──►     { op, selector, outerHTML, ──► recordOperation ──►  planEdit ──► processGroup ──►  replaceIfVersion
drag drop                    path, textSnippet,            enqueueOperation      （路由 + 定位）  （读/补丁/写）
                             sourceHints, target* }        sync-queue(550ms)     locateElementDetailed
```

### 2.1 触发面

| 触发 | 代码 | 说明 |
| --- | --- | --- |
| 样式卡垃圾桶 | `src/runtime/domains/design/10-card.ts:601-623` | 先 `structurePayloadOf` 再 `applyRemoveTo` |
| `Delete` / `Backspace` | `src/runtime/domains/interaction/10-handlers.ts:256-262` | 仅 edit 模式 + 有选中 + 非输入控件 + 非浮层 |
| 拖动重排/改父级 | `src/runtime/domains/interaction/10-handlers.ts:124,147` | `structureDropAt` 计算落点，`structureMove` 执行 |

### 2.2 事件与 payload

`structurePayloadOf`（`10-card.ts:782-790`）在 **DOM 变更之前**采集：

```js
{ selector: cssPath(element),          // 例如 article.marketing-card:nth-of-type(1)
  path: pathOf(element),               // 从 documentElement 起算的 element-child 索引
  outerHTML: ≤4000 字符（超出 … 截断）,  // 10-card.ts:773-781
  textSnippet: visibleTextOf(element), // 原始未截断，wire 阶段截到 160
  sourceHints: sourceHintsOf(element) }// {file?,line?} 或 {styleHref,styleSelector}
```

move 额外带（`10-card.ts:824-839`）：`targetParentSelector` / `targetParentPath` / `targetParentOuterHTML` / `targetParentTextBefore`、`beforeSelector|null` / `beforePath` / `beforeOuterHTML` / `beforeTextBefore`。

⚠️ 两个已确认的「采集正确、传输丢失」：
- **没有 `textBefore`**：元素自身文本只以 `textSnippet` 存在（F3）。
- **`targetParentPath` / `beforePath` 在 wire 前被丢掉**：Client 只把 `targetParentSelector/targetParentOuterHTML/targetParentTextBefore` 与 `beforeSelector/beforeOuterHTML/beforeTextBefore` 传下去（`body.tsx:785-809`、`sync-queue.ts:92-99`），Host 的 EditRecord 也没有这两个字段（`src/host/source-sync.ts:28-34`）（F12）。

### 2.3 Client 队列

`src/client/domains/persistence/sync-queue.ts`：

- 记录键 `keyOf()`（`:32-38`）：结构操作是 `remove|<selector>` / `move|<selector>`；**同一元素 550ms 内的第二次拖动会覆盖第一次**（F14）。
- wire payload（`:70-110`）：`outerHTML` 再截 4000、`textSnippet` 截 160（`:76-77`）。
- 状态聚合（`:111-151`）：`failed>0 → error`；否则 `synced>0 → done`；否则 `preview`。**`previewReason` 只在「一条都没写成」时才保留**（F8）。

### 2.4 Host 规划与定位

`src/host/domains/persistence/index.ts`：

- `planEdit`（`:173-303`）按顺序：**hint（`:253-268`）→ URL 映射（`:271-275`）→ 有界搜索（`:276-298`）**。
  - hint 只验证「文件存在且扩展名可补丁」，**不验证元素在不在里面**；命中即 `return`（F1）。
  - URL 映射只要文件存在就 `return`；搜索只在映射**解析不到文件**时运行（F2）。
- `processGroup`（`:305-425`）：同文件合并为一次读/一次写；`applyEditToContent`（`:427-442`）分发到 `html-remove` / `html-move`。
- 定位：`html/locate.ts:33-60` 的阶梯 **id → 归一化 outerHTML（全量→200→80 前缀→属性签名→40 字文本头）→ textBefore（仅当 `edit.textBefore` 存在）→ DOM path**；失败返回 `unresolved-element` / `ambiguous-element` / `path-mismatch`。
- 补丁：`edits/markup.ts:348-363`（remove，含整行清理）、`:365-467`（move，含缩进/偏移重映射）。

### 2.5 状态回传

Host 的逐条 `results[]` 是完整的（`status/file/line/strategy/reason`），Client 也逐条写进 `history.ops[].syncStatus`（`platform/history.ts:60-71`）——**但 UI 从不渲染逐条状态**，只渲染一条 2.6 秒后消失的聚合提示（`body.tsx:213-243`）。

---

## 3. 实测证据

### 3.1 真实 Chromium CDP 复现（demo 页，真点击 / 真拖拽）

运行时用 `lib/runtime.js` 注入 `http://127.0.0.1:4173/`，Host 用 `lib/source-sync.js` 对 demo 临时副本执行，payload 按 Client 的真实形状还原：

| # | 场景 | 触发 | 结果 | 写盘 |
| --- | --- | --- | --- | --- |
| 1 | 有 hint，删 `#open-card` | Delete 键 | `synced / html-remove / demo/index.html:34` | ✅ |
| 2 | 有 hint，删 `#open-card` | 样式卡 🗑 | 同上 | ✅ |
| 3 | 有 hint，拖 `#open-card` 到 `#hero` 前 | 真实鼠标拖拽 | `synced / html-move` | ✅ |
| 4 | 有 hint（继承自 topbar），删无 class 的导航链接 | Delete 键 | `synced / html-remove / demo/index.html:27` | ✅ |
| 5 | 删静态营销卡片（hint 指向 `demo/app.js:18`） | Delete 键 | **`preview / unresolved-element / demo/app.js`** | ❌ |
| 6 | 拖同一张卡片（hint 同上） | 拖拽 | **`preview / unresolved-element / demo/app.js`** | ❌ |
| 7 | 无 hint，删 `#open-card` | Delete 键 | `synced / html-remove / demo/index.html:34` | ✅ |
| 8 | 无 hint，删 **JS 渲染**的 `#dynamic-card-1` | Delete 键 | **`preview / unresolved-element / demo/index.html`** | ❌ |
| 9 | 无 hint，删静态营销卡片 | Delete 键 | `synced / search / demo/index.html:93` | ✅ |
| 10 | 无 hint，拖 `#open-card` | 拖拽 | `synced / search / html-move` | ✅ |
| 11 | 对照：样式编辑 `#hero` | 运行时 API | `synced / html-override / demo/index.html:18` | ✅ |

**结论**：11 个场景里 8 个写盘成功、3 个 `preview`。失败全部集中在两条：**hint 把路由钉死在错误文件**（#5/#6：卡片标记在 `index.html:93`，hint 却指向 `app.js:18`）与 **URL 映射文件存在但元素是 JS 渲染的**（#8：`#dynamic-card-1` 在 `index.html` 里根本不存在，搜索回退未触发）。也就是说结构回写链路本身是通的，坏在路由与降级策略上。

### 3.2 重放（refresh → reapply）实测：会删错元素

按 `restoreRuntime()` 的真实形状构造 reapply 请求（`body.tsx:711-739` → `carrier.ts:312` → `10-apply.ts:156-179`），在**已写入补丁**的页面上执行：

| 步骤 | `#card-grid > article.marketing-card` 顺序 | reapply 结果 |
| --- | --- | --- |
| reload 后（补丁已生效） | 问界 M9, 小米 SU7, 极氪 001, 小鹏 X9 | — |
| reapply ×1 | **小米 SU7**, 极氪 001, 小鹏 X9 | `{applied:1, failed:0}` |
| 再 reload 后 | 问界 M9, 小米 SU7, 极氪 001, 小鹏 X9 | — |
| reapply ×1 | **小米 SU7**, 极氪 001, 小鹏 X9 | `{applied:1, failed:0}` |
| 连续 reapply ×2（不 reload） | 极氪 001, 小鹏 X9 | 每轮 `{applied:1, failed:0}` |

原因：重放用的 `selector` 是捕获时的 `cssPath`（`article.marketing-card:nth-of-type(1)`），源码补丁把第 1 张卡片删掉后，`:nth-of-type(1)` 指向了原来的第 2 张 → **每刷新一次就再删掉一张错误的卡片**，而源码只被正确改过一次。这同时解释了「刷新后页面又变了 / 又少一个」和「源码看起来没回写」。

> 该场景直接驱动 `window.__DSH_NUDGE__.reapply(...)`（与 `restoreRuntime()` 发出的命令同形），未走 GUI 传输层；运行时与 Host 都是发布产物 `lib/*.js`。move 场景未采到拖拽 payload，未测。

### 3.3 Host 探针（27 组，节选关键项）

| 探针 | 输入 | 结果 |
| --- | --- | --- |
| E1a | demo 静态卡片，真实 hint `demo/app.js:18` | **`preview / unresolved-element / demo/app.js`，未写盘** |
| E1b | 同 payload，去掉 hint | `synced / search / demo/index.html` |
| S1 | Vite 风格 SPA，URL `/` → 存在 shell `index.html` | `preview / unresolved-element / index.html`（元素其实在 `src/Panel.tsx`） |
| S3 | 同一 SPA 编辑，URL `/dashboard`（映射未命中→触发搜索） | `synced / search / src/Panel.tsx`，但产物是 `return (\n  )`（**非法 JS**） |
| E7 | 从 `.tsx` 删掉 `{cond && <p className="hint">…</p>}` 里的 `<p>` | **`synced`，文件变成 `{cond && }`（非法 TSX）** |
| E5 | 陈旧 path + 截断 outerHTML + 两个同文本前缀的兄弟 `<p>` | **`synced`，删掉的是第一个（错的）+ 少了一个元素** |
| E13 | 删除 JS 生成的 `<li>`（与源码里唯一静态 `<li>` 标记相同） | `synced`，**写掉的是静态源码里的那个 `<li>`** |
| E3 | 两个完全相同的空 `<span class="icon">`，只能靠 path 区分 | `synced`（说明 path 是承重锚点） |
| E9 | 元素先做过一次「仅预览」的文本修改，再删 | `preview / path-mismatch` |
| A1/A2 | move 目标容器无 id/class 且重复（payload 里 `targetParentPath` 正确） | `preview / unresolved-target-parent` / `unresolved-target-anchor` |
| E14 | 拖进 `script` / `textarea` / 自闭合 `<x-box />` | `preview / unsupported-target-parent` |
| E15 | 指向错误文件但可解析的 hint（URL 映射本可命中） | `preview / path-mismatch / other.html` |

探针脚本见 `plugin/test/.tmp-audit/probe{,2,3,4,5}.mjs`（临时目录，不纳入仓库）。

---

## 4. 根因分析（按失效层）

### 4.1 路由层：把「提示」当成「事实」

- **F1（高）** `hints.file` 一旦解析成可补丁文件，`planEdit` 立即返回；元素在该文件找不到时是**终结性**结果，不会回退（`index.ts:253-268` + `:351-371`）。而运行时 `sourceHintsOf` 会**向上继承 8 层祖先**的 `data-source`（`core/50-descriptor.ts:33-57`），所以一个布局容器的 hint 会污染整棵子树的定位。demo 页正是这种形状。
- **F2（高）** URL 映射只要目标文件存在就终止；搜索仅在「映射文件缺失」时运行（`index.ts:271-298`）。对任何 `index.html` 只是挂载壳的 SPA，结构编辑**每次**都失败。
- **F13（中低）** `data-source="file:line"` 里的 `line` —— 页面能提供的最精确锚点 —— 被解析、写进契约，却**从未被 Host 读取**。

### 4.2 锚点层：采集了，但没接上

- **F3（高）** 元素自身文本锚点断链：runtime 用 `textSnippet`，client 透传 `textSnippet`，locator 只读 `textBefore`（`html/locate.ts:164-166`）。结构操作因此丢掉文档里约定的第 3 级定位。
- **F12（中）** move 的父级/锚点 DOM path 在 wire 与 EditRecord 中不存在；无 id/class 的重复容器**必然** `unresolved-target-parent`。
- **F6（中）** `outerHTML` 三处截断（runtime 4000 / descriptor 4000 / client 4000）把「唯一匹配」降级成「200 字前缀」；开标签本身被截断时，属性签名与文本头两条兜底也会被跳过（`locate.ts:125-126`）。
- **live DOM ≠ 源码**的一般成因：内联 `style` 注入（此前样式编辑）、插件 override 块、浏览器属性序列化差异、`data-*` 运行时改写、JS 渲染的包装节点。

### 4.3 定位层：path 承重且易碎

- **F7（中高）** `path` 是结构编辑的**实际承重锚点**（E3），但旧版 `docs/source-sync.md` 声称它「不被用于定位」——文档错误，本轮已在该文件更正（`path` 现被描述为 last-resort locator）。
- path 是 DOM 的 element-child 索引，Host 走的是源码分词树的索引；只有「源码树与 live DOM 同构」时才成立。JS 渲染、控制流节点、以及**任何一次未落盘的结构编辑**都会让它错位。
- **F5（高）** 截断 payload 会让 path 守卫退化成「前 60 字文本相同即可」（`locate.ts:238-253`），于是一个陈旧 path 可以删掉同标签的**另一个**元素并上报 `synced`。

### 4.4 补丁层：HTML 分词器不该碰 JS/JSX

- **F4（高）** `MARKUP_EXTENSIONS` 包含 `js/jsx/ts/tsx/mjs/cjs`（`constants.ts:18`），remove/move 对它们一律可用（`validate.ts:23-26`），但补丁是纯字符区间剪切（`markup.ts:348-467`），没有 JS/JSX 语法感知。实测会产出 `{cond && }`、`return ( )` 这类非法代码，并报 `synced`。
- **E13（中）** 标记完全相同的「JS 生成节点 ↔ 源码静态节点」无法区分，写回会命中静态节点。

### 4.5 状态层：唯一反馈渠道会撒谎

- **F8（高）** `flush()` 的聚合规则（`sync-queue.ts:130,148`）让「样式写成功 + 结构仅预览」显示为「已同步」；`previewReason` 被丢弃。
- 逐条 `syncStatus` 存在却无处显示；`syncReasonText` 只本地化 3 个 reason（`body.tsx:29-35`），结构编辑常见的 `protected-element` / `unresolved-target-parent` / `unresolved-target-anchor` / `invalid-move-target` / `unsupported-target-parent` 全部原样显示英文 snake_case，或干脆被 2.6 秒后消失的提示带走。
- **F18（中低）** 还有若干静默丢弃路径：空 selector 直接忽略（`body.tsx:679`）、`drainEvents` 的 `.catch(function(){})` 吞异常（`:587-590`）、无 session 时清空批次（`sync-queue.ts:52-62`）。

### 4.6 会话层：重放与撤销是一笔糊涂账

- **F9（高）** 结构操作被明确排除在撤销之外（`body.tsx:823-832`），文案称「刷新页面可恢复 DOM」。但刷新会走 `loaded → restoreRuntime()`，把历史里**所有** `syncStatus !== 'undone'` 的 op（含 remove/move）重放一遍（`body.tsx:711-739` → `carrier.ts:302-318` → `10-apply.ts:156-179`）。所以「刷新可恢复」是错的。
- **F10（高）** 重放**忽略 `history.index`**；`'undone'` 只被读、从未被写 → 样式/文本的撤销在刷新后会复活（README 的相反描述也不成立）。
- **F11（中高）** 重放不带 URL 作用域、在 `did-finish-load` 就执行、失败结果被丢弃；对 JS 渲染页面，重放可能跑在内容渲染之前而 no-op —— 于是「preview 过的删除」在刷新后又回来（源码本来就没写）。
- **幂等性缺失（已实测，见 §3.2）**：重放用捕获时的 `cssPath`（`span:nth-of-type(3)` 这类）重新定位，写盘成功后源码顺序已变，同一个 selector 指向**另一个元素** —— 每次刷新都会再删/再移动一个错误元素（实测删卡片场景：reload→reapply 把下一张卡片也删了）。这是 F9/F10 之外更严重的一致性问题，P0 必须先止血（落盘 op 不再重放），P1 用「句柄 + 逆操作」根治。

### 4.7 工程层：覆盖与文档缺口

- **F17** 旧版 `docs/source-sync.md` 的策略表没有 `html-remove` / `html-move`、reason 列表缺 6 个结构 reason、Known limitations 未提结构编辑、`path` 描述错误；README / ACCEPTANCE 从未记录「删除元素 / 拖动」这两个交互。**本轮已修** `source-sync.md` 与 `README.md`（见附录 B）；`docs/ACCEPTANCE.md` 与中文本地化仍待补。
- **Q8 测试缺口**：`source-sync.test.mjs` 有结构单测但只覆盖 id 锚点；**没有** client→host payload 形状测试、hint 误导测试、SPA shell 测试、重复标记/截断/JSX 测试、混合批次状态测试；`validation/runtime-cdp.mjs` **没有**任何结构编辑用例（`test/.tmp-repro` 是唯一真实 CDP 覆盖，且不进 `npm test`）。
- **F16** 中文本地化漏传 `designDelete/designDeleteHint/designMoveHint`（`body.tsx:142-201` 未转发），中文界面里删除按钮的 tooltip 是英文 "Delete element"。

---

## 5. 设计目标与非目标

**目标**

1. **确定性**：结构操作要么精确写回并给出 `file:line`，要么给出**可执行的诊断**（候选文件 + 失败原因 + 一键指定），不允许「静默预览」。
2. **安全**：绝不产生语法非法/语义错位的写入；宁可 `preview` 也不猜。
3. **一致性**：页内状态、源码状态、历史（撤销/重做）三者始终可解释；刷新不产生「意外回滚」或「重复应用」。
4. **可扩展**：为 `insert / duplicate / wrap / unwrap / 跨文件 move` 预留同一条锚点与补丁管线。
5. **可测**：每个根因都有对应回归用例，结构编辑进真实 CDP 验收。

**非目标**

- 不做整页序列化重写（会破坏格式/注释/非 DOM 生成内容）。
- 不承诺「任意 JS 渲染的节点都能写回源码」；对这类节点给出**运行时覆盖（sidecar）**或明确不可写回的诊断。
- 不在本期引入框架 AST 级改写（P2 的探索方向，见 §13）。

---

## 6. 方案总览

```
                    ┌───────────────────────────── Client ─────────────────────────────┐
 结构手势 ──► runtime 采集 Anchor v2 ──► 队列(结构操作不合并) ──► 逐条状态 UI
                    │        │                                              ▲
                    │        └──────────── sync(edits, pageSession) ───────┘
                    ▼                                                       │
          ┌──────────────────────────── Host ────────────────────────────────┴─────────┐
          │ ① 目标解析器：hint / URL 映射 / 搜索 三者产出「候选集」，不再首命中即终止      │
          │ ② 定位引擎：9 级确定性阶梯 + 标记规范化 + 多候选评分 + 拒绝(带候选)            │
          │ ③ 结构补丁器：extent 计算 → offset 重映射 → 语法闸门 → 最小 diff 写出          │
          │ ④ 会话层：elementHandle 缓存 + fileRevision CAS + idempotencyKey + 逆操作      │
          └────────────────────────────────────────────────────────────────────────────┘
```

关键思路有三条：

1. **「先定位、后路由」取代「先路由、后定位」**：候选文件可以多个，定位结果参与路由决策；hint 退化为「打分项 + 优先探测项」，而不是事实。
2. **锚点是协议，不是启发式**：Anchor v2 显式区分「稳定身份 / 结构上下文 / 内容指纹」，每级都有置信度与失败原因；服务端在成功定位后**签发句柄**，后续同元素操作直接命中，不再靠猜。
3. **结构操作是一等公民**：独立队列语义（不合并）、独立状态展示、独立撤销（逆操作）、独立安全闸门（JS/JSX 默认拒绝）。

---

## 7. 详细设计

### 7.1 路由：候选集 + 定位反馈

```ts
type TargetCandidate = {
  file: string            // workspace 相对路径
  strategy: 'html-remove' | 'html-move' | ...
  via: 'handle' | 'hint' | 'url' | 'search'
  score: number           // 0..100，定位成功才进入 commit
}

// planEdit 改为：收集候选（按 handle→hint→url→search 顺序去重、不提前 return），
// 对每个候选执行 locate；第一个唯一命中且通过安全闸门的成为 plan；
// 全部失败时返回 preview，并带 candidates: {file, reason, lineHint}[]
```

- hint 命中但定位失败 → **继续**下一个候选（修 F1）。
- URL 映射文件存在但定位失败 → **继续**搜索（修 F2）。
- `hints.line` 作为定位窗口：在 `line ± 40` 行内按 tag + id/class 匹配，命中即高置信（修 F13）。
- 搜索结果若唯一且分数 ≥ 阈值才加入候选；多个同分候选 → `ambiguous-element` 并列出候选（修 E13 的静默错写）。

### 7.2 Anchor v2

```ts
interface Marker {                     // 一个元素的最小可比较身份
  tag: string
  id?: string
  classes: string[]                    // 排序后，忽略运行时注入类（dsh-nudge-*、data-* 生成的 hash 类）
  outerHtmlDigest: string              // sha256(normalizeMarkup(outerHTML))
  textDigest: string                    // sha256(normalizeText(visibleText))
  textSample: string                    // 归一化文本前 512 字（用于候选打分）
}

interface StructureAnchor {
  version: 2
  marker: Marker
  domPath: number[]                     // 预变更 DOM 的 element-child 索引
  selector: string                      // cssPath（仅作兜底候选）
  outerHtml: string                     // ≤64KiB，超出时置 outerHtmlTruncated=true（不再拼 …）
  outerHtmlTruncated: boolean
  parent: Marker
  prevSibling?: Marker                  // 兄弟差分锚点（新增）
  nextSibling?: Marker                  // 兄弟差分锚点（新增）
  hints?: { file?: string; line?: number; styleHref?: string; styleSelector?: string }
  handle?: ElementHandle                // 服务端签发，见 §7.5
  pageUrl: string                       // 重放作用域（修 F11）
}

interface ElementHandle {               // Host 定位成功后的稳定坐标
  file: string
  line: number
  openStart: number                     // 源码 byte/char offset
  elementDigest: string                 // sha256(源码里该元素 extent 的规范化标记)
  revision: string                      // 该文件写入后的版本（mtime+size 或内容 hash）
}
```

要点：

- **`textBefore` 是 `textSample` 的别名**：wire 上结构操作同时携带 `textSnippet`（展示用）与 `textBefore`（定位用），Host 统一读后者（修 F3）。
- **截断改为「标记」而不是「省略号」**：`outerHtmlTruncated` 让 Host 明确知道「不能拿它做 path 校验」（修 F5/F6）。
- **兄弟差分**：重复组件（卡片、表格行、导航项）用 `(prevSibling.textDigest, nextSibling.textDigest)` 定位，解决「唯一 outerHTML 不存在」的歧义。
- **归一化函数 `normalizeMarkup`**：折叠空白、统一自闭合、属性按名排序、引号统一、实体解码、剔除 `data-dsh-nudge-*` / 运行时注入 `style`（可选开关）。归一化保证「live DOM 与源码的等价比较」，这是当前最缺的一块。

### 7.3 定位引擎：9 级阶梯（命中即停，全部失败才拒绝）

| 级 | 锚点 | 失败原因 | 置信度 |
| --- | --- | --- | --- |
| 1 | `handle` + `revision` 未变 | `stale-handle` → 降级 | 99 |
| 2 | `hints.line` 窗口内 tag + id/class | `unresolved-element` | 95 |
| 3 | 唯一 `id` | `ambiguous-element` | 90 |
| 4 | 归一化 `outerHtml` 精确匹配 | `unresolved-element` | 85 |
| 5 | 父容器内 `(prev,next)` 兄弟差分唯一 | `ambiguous-element` | 80 |
| 6 | `textBefore`（归一化，按 selector token 约束） | `unresolved-element` | 75 |
| 7 | 开标签属性签名 + 文本头 | `ambiguous-element` | 60 |
| 8 | `domPath` + 结构签名校验（截断时改为「开标签签名 + 全文本相等」） | `path-mismatch` | 50 |
| 9 | 有界搜索唯一最佳（仅 markup 文件） | `no-source-mapping` | 40 |

安全规则：

- 第 8 级只在 `outerHtmlTruncated === false` 时允许宽松文本头；截断时必须开标签属性签名一致（修 F5）。
- 第 9 级默认**排除** `.js/.jsx/.ts/.tsx/.mjs/.cjs`，除非用户显式「允许写入 JS 源码」（修 F4/E13）。
- 任一级出现多候选，**不猜**：返回 `ambiguous-element` + 候选列表（UI 可点选，选中后由 Host 写一次 handle）。

### 7.4 结构补丁引擎

在现有 `applyMarkupRemoveEdit` / `applyMarkupMoveEdit` 之上增加三个前置/后置环节：

1. **extent 与语法上下文**：`locate` 返回 `{openStart, openEnd, innerStart, innerEnd, closeEnd, tagIndex, inExpressionContainer, inTemplateLiteral, isSoleReturnChild}`。
   - 命中 `.js/.jsx/.ts/.tsx` 且 `inExpressionContainer || inTemplateLiteral || isSoleReturnChild` → **拒绝**，reason `unsafe-js-context`，提示改用「参数化」或手动改。
   - 允许的 JS/JSX 场景：元素是 JSX 中的独立子节点（`<div><p/><span/></div>` 的 `<p/>`），且删除后不出现孤立的 `{cond && }` —— 用「补丁后重新分词，断言元素计数与开闭标签平衡」做最小校验。
2. **move 的 offset 重映射**：保留现有 `mapped = insertAt ± cut` 逻辑，但增加「插入点必须位于目标父元素的 `innerStart..innerEnd` 内」断言与「不得插入到自身子树」断言。
3. **最小 diff 写出**：写盘前产出 unified diff 摘要（写入结果、行数、前后 2 行上下文）随 `results[]` 回传，UI 可展开；批量写仍保证「同文件一次读、一次写、CAS」。

新增结构操作（P2）：`insert`（复制锚点元素 / 插入模板）、`duplicate`、`wrap`（用模板包裹）、`unwrap`、`reorder`（同一父级内移动）。它们的锚点模型与 remove/move 完全一致，只需扩 `kind` 与补丁器。

### 7.5 会话一致性与幂等

```ts
// Client：每个 tab 维护
type PageSession = {
  pageUrl: string
  fileRevisions: Record<string, string>   // 每次 sync 结果刷新
  handles: Record<string, ElementHandle>  // key = domPath.join('.') 或 selector
  appliedIdempotencyKeys: string[]
}
```

- **句柄签发**：Host 成功定位后返回 `handle`；Client 按 `domPath` 缓存。下一次对同一元素的操作先试 handle（一次字符串比较，成本 O(1)），失败再走阶梯。
- **revision CAS**：写盘仍用 `replaceIfVersion`；返回 `{file, revision}`；Client 更新。revision 不同意味着「源码被外部/HMR 改过」→ 旧 handle 失效并降级。
- **幂等键**：`idempotencyKey = sha256(pageUrl + handle-or-marker + kind + 变更摘要)`。Host 保留最近 N 条已应用键（内存 + 可选 `.dsh/nudge-idempotency.json`），重复请求返回缓存结果，不重复写。这解决「重试/重放导致二次写入」。
- **写前校验**：结构操作额外做「结果元素计数」断言（remove 后计数 -1；move 后两处计数一致），不满足则 `preview` + warning。

### 7.6 撤销 / 重做 / 重放

现状（F9/F10/F11）全部推翻重做：

| 语义 | 现状 | 新设计 |
| --- | --- | --- |
| 结构撤销 | 不支持，提示「刷新可恢复」 | **逆操作**：remove 的逆 = 用保存的 `outerHTML` + 原 `prev/next` 兄弟锚点 insert；move 的逆 = 反向 move（原插入点与父级已保存在 op.inverse） |
| 撤销后的重放 | 忽略 `history.index`；`'undone'` 死代码 | 重放 `ops.slice(0, index + 1)`，并把被撤销 op 标 `'undone'` |
| 已落盘 op 的重放 | 无条件重放（非幂等） | op 增加 `persisted: boolean`（Host `synced` 后置真）；**只重放 `preview` 且未落盘的 op** |
| 作用域 | 无 URL，跨页重放 | op 记 `pageUrl`；`loaded` 时只重放同 URL 的 op |
| 时序 | `did-finish-load` 立即执行，失败丢弃 | 等 `runtime-ready` + 内容稳定（MutationObserver 静默 300ms）后执行；失败逐条上报给 UI |

文案同步改：结构操作可撤销后，删除 `dock.structureUndoUnavailable` 这套提示；在撤销完成时提示「已撤销并回写源码」。

### 7.7 反馈与可诊断性

1. **逐条状态**：每个结构操作在 `history.ops[].syncStatus` 已有数据，新增渲染——
   - 工具栏「同步」chip：`N 已同步 / M 仅预览 / K 失败`，点击展开列表；
   - 页内元素旁 2 秒 pill：`已写入 index.html:33` / `仅预览：找不到元素`；
   - 失败项可点「详情」查看候选文件与原因、可「指定源文件」写一次 handle。
2. **reason 全量本地化**（含 `protected-element`、`unresolved-target-parent`、`unresolved-target-anchor`、`invalid-move-target`、`unsupported-target-parent`、`unsafe-js-context`、`stale-handle`），并附一句「怎么办」。
3. **不再有静默失败**：空 selector / 无 session / 受保护元素 / 无落点拖拽都必须给出提示（修 F15/F18）。
4. **文案一致**：任何「刷新可恢复」的话术必须与重放语义一致（P0 先改文档与文案，P1 再让撤销真正可用）。

### 7.8 安全闸门

| 闸门 | 规则 |
| --- | --- |
| 扩展名 | 结构编辑默认只在 `html/htm/vue/svelte/astro`；`js/jsx/ts/tsx/mjs/cjs` 需显式开关 |
| JS 上下文 | 表达式容器 / 模板字符串 / 唯一 `return (...)` 子节点 → 拒绝（`unsafe-js-context`） |
| 语法自检 | 补丁后做「标签平衡 + 元素计数」断言（JSX 额外做括号平衡） |
| 受影响范围 | 删除/移动超过 N 行（默认 200）或包含 `<script>`/表单控件 → 提示确认 |
| 可回滚 | 写盘前记录 `{file, beforeHash}`；插件已有 git 面板，可一键 `git diff`/恢复 |
| 幂等 | 同幂等键写入只生效一次 |

---

## 8. 接口契约（增量）

```ts
// Host 入参（sync）
type SyncRequest = {
  session: string
  page: { url: string; title?: string }
  pageSession?: { fileRevisions: Record<string, string> }   // 新增
  edits: StructureEdit[]
}

type StructureEdit = {
  id: string
  kind: 'style' | 'text' | 'attr' | 'remove' | 'move' | 'insert' | 'duplicate' | 'wrap' | 'unwrap'
  anchor: StructureAnchor              // style/text/attr 沿用旧字段，结构操作用 anchor
  target?: { parent: Marker; before?: Marker; parentDomPath?: number[]; beforeDomPath?: number[] }
  idempotencyKey: string
}

type SyncResult = {
  results: Array<{
    id: string
    status: 'synced' | 'preview' | 'failed'
    reason?: string
    file?: string; line?: number; strategy?: string
    handle?: ElementHandle           // 新增
    revision?: string                // 新增
    diffSummary?: string             // 新增：写盘前后摘要
    candidates?: Array<{ file: string; line?: number; why: string }>  // 新增：仅 preview 时
  }>
  files: string[]
  warnings: string[]
}
```

向后兼容：Host 继续接受旧扁平字段（`selector/path/outerHTML/textSnippet/…`），内部适配成 `anchor`；旧客户端不认识 `handle/revision/candidates` 时忽略即可。

---

## 9. 核心算法伪代码

**定位（结构操作）**

```text
locate(anchor, candidates):
  for cand in candidates:                       # handle → hint → url → search
    content = read(cand.file)
    if anchor.handle and anchor.handle.file == cand.file and revisionMatches(handle):
        if markerAt(content, handle) == handle.elementDigest: return hit(cand, 99)
    if anchor.hints.line and locateNearLine(content, anchor.hints.line, anchor.marker): return hit(cand, 95)
    if unique id: return hit(cand, 90)
    if unique normalize(outerHtml): return hit(cand, 85)
    if siblingDiff(anchor.parent, anchor.prevSibling, anchor.nextSibling) unique: return hit(cand, 80)
    if unique textBefore(+token filter): return hit(cand, 75)
    if attrSignature + textHead unique: return hit(cand, 60)
    if !anchor.outerHtmlTruncated and pathGuardStrong(content, anchor): return hit(cand, 50)
  return { preview: { reason: 'ambiguous-element'|'unresolved-element'|..., candidates } }
```

**幂等写**

```text
apply(edit):
  if journal.has(edit.idempotencyKey): return journal.get(edit.idempotencyKey)
  hit = locate(edit.anchor, candidates(edit))
  if !hit: return preview(reason, candidates)
  assert !unsafeJsContext(hit) else return preview('unsafe-js-context')
  before = read(hit.file)
  after  = patch(before, edit, hit)
  assert balanced(after) else return preview('patch-unsafe', diff(before, after))
  write(hit.file, after, replaceIfVersion(before.version))
  handle = issueHandle(hit.file, after, edit)
  journal.put(edit.idempotencyKey, result(handle, diffSummary))
  return synced(handle)
```

---

## 10. 分阶段实施

### P0（1–2 天）：止血，让回写变确定 —— ✅ 本轮已完成

| # | 改动 | 文件 | 状态 |
| --- | --- | --- | --- |
| P0-1 | hint 定位失败后继续 URL 映射与搜索；URL 映射文件存在但定位失败也继续搜索 | `src/host/domains/persistence/index.ts`（planCandidates 候选集 + probePlan） | ✅ 34→35 组单测覆盖（wrong-hint / mapped-shell / candidates 诊断） |
| P0-2 | 结构操作补齐 `textBefore`（runtime 全量、client 转发、host `textSnippet` 兜底） | `10-card.ts`、`sync-queue.ts`、`html/locate.ts` | ✅ |
| P0-3 | 截断语义改为 `outerHTMLTruncated`；截断时禁止宽松 path 守卫（改为开标签签名 + 全文相等） | `10-card.ts`、`sync-queue.ts`、`locate.ts` | ✅ 单测覆盖 stale path + truncated |
| P0-4 | JS/JSX 结构编辑闸门：结构 kind 只允许 html/htm/vue/svelte/astro，JS 源返回 `unsupported-js-source` | `validate.ts`、`constants.ts` | ✅ 单测保证 `.jsx` 字节不变；文本编辑仍可写 |
| P0-5 | 状态聚合修正：新增 `partial`，全部 synced 才 `done`，preview/error 常驻提示 | `sync-queue.ts`、`body.tsx` | ✅ client-smoke 覆盖状态机 |
| P0-6 | 重放只重放未落盘 + index 之前 + 同 URL 的 op；`'undone'` 真正写入；结构撤销/重做同步回写 | `body.tsx`、`platform/history.ts`、`applyInsert`/`applyMoveElement` | ✅ 修掉「刷新删掉下一张卡片」 |
| P0-7 | reason 全量本地化 + 补 `designDelete*` 转发 | `locale/*.json`、`body.tsx` | ✅ zh/en 双向校验 |
| P0-8 | 文档修订：`docs/source-sync.md` 补策略/reason/限制并纠正 `path`；README 补结构编辑 | `docs/source-sync.md`、`README.md` | ✅ 见附录 B |

### P1（3–5 天）：Anchor v2 + 会话一致性

- Anchor v2 采集与 `normalizeMarkup`（新 `src/host/domains/persistence/html/normalize.ts`）。
- 9 级定位阶梯 + 候选诊断 + `hints.line` 窗口（`html/locate.ts` 重写）。
- 服务端句柄签发 + `fileRevisions` + `idempotencyKey` + journal（`index.ts` + `src/host/index.ts`）。
- 结构撤销/重做（逆操作）、重放按 `index`/URL/`persisted` 过滤。
- 逐条状态 UI（工具栏 chip + 元素 pill + 候选选择）。
- 转发 `targetParentPath` / `beforePath` 并在 move 补丁器作为最后兜底（修 F12）。

### P2（1–2 周）：能力扩展与框架感知

- `insert / duplicate / wrap / unwrap / reorder / 跨文件 move`。
- 兄弟差分锚点的完整实现与重复组件专测。
- JSX/Vue/Svelte 语境感知（`<template>` 解析、JSX 子节点白名单、`v-if`/`{#if}` 分支拒写）。
- 框架 source map / fiber 定位探索（可选）。
- 重度动态页面的 **sidecar 运行时覆盖**兜底（见 §13）。

---

## 11. 测试计划

**单测（`test/source-sync.test.mjs` 扩展）**

1. 定位阶梯逐级命中/歧义/拒绝（每级 2 个 fixture）。
2. 路由：hint 正确 / hint 误导（E1a）/ hint 指向 CSS / 映射文件存在但元素不在（S1）/ 搜索唯一与并列。
3. 截断：4516 字符元素、重复前缀兄弟、截断 + 陈旧 path（E4/E5）。
4. JS/JSX：表达式容器、模板字符串、独立 JSX 子节点、`return (...)` 唯一子节点（E7/S3c）。
5. move：重复容器、重复锚点（A1/A2）、自闭合父级、跨文件、自身子树。
6. 幂等：同 key 重复 apply 只写一次；revision 变化后 handle 失效。
7. 状态：混合批次聚合、preview reason 保留。

**Client 单测（`test/client-smoke.mjs`）**

- 结构记录的 wire 形状（`textBefore` 是否存在、path 是否转发、结构记录不被 coalesce 合并）。
- 重放过滤：`index`、`persisted`、URL 作用域。

**真实 CDP（`validation/runtime-cdp.mjs` 新增 `structure` 套件）**

- 真点击 → 样式卡 🗑 → 断言源码 diff；
- 真 `Delete` 键 → 断言源码 diff；
- 真鼠标拖拽重排/改父级 → 断言源码 diff 与缩进；
- 重复卡片删除 → 断言只有目标卡片消失；
- JS 渲染节点删除 → 断言 `preview` 且提示可读，源码不变；
- 撤销 → 断言源码 diff 反向。

**回归矩阵**：静态 HTML / JS 渲染 / SPA shell / 重复组件 / 有 hint / 无 hint / 已做样式编辑 / 上一结构编辑已落盘 / 只读会话。

**量化指标**：结构操作 `synced` 率（按页面原型分桶）、错误文件写入 = 0、非法语法产出 = 0、重复刷新 DOM 漂移 = 0、结构撤销成功率 ≥ 99%。

---

## 12. 兼容与迁移

- **wire 兼容**：Host 同时接受旧扁平字段与 `anchor`；旧 `lib/client.js` 与新 Host 混用时走旧路径（P0 修复对双方都生效，因为都是 Host 侧路由/定位 + Client 侧字段）。
- **历史兼容**：旧 op 没有 `anchor/persisted/pageUrl` → 视为 `persisted=false`、`pageUrl=当前页`，仍可重放；一次成功同步后回填。
- **数据兼容**：无 sidecar 时行为不变；启用幂等 journal 后新增 `.dsh/` 下的本地文件，需加入 watcher 忽略列表（现已忽略 `.dsh`）。
- **文档兼容**：`docs/source-sync.md` 仍描述 style/text/attr；新增「结构编辑」章节并链接本文。

---

## 13. 风险与备选方案

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 锚点仍不足 | 重度动态页面（虚拟列表、Canvas、Web Component）DOM 与源码无对应 | P2 的 sidecar：把结构变更写成 `.dsh/nudge-overlays.json`，由 runtime 在加载后重放，UI 明确标注「运行时覆盖，不改源码」 |
| 写回破坏语义 | 删除/移动可能破坏 a11y、框架状态、事件绑定 | dry-run diff + git 检查点 + 大范围变更确认闸门 |
| 框架组件 | 源码是 JSX/Vue 模板，文本节点可能来自表达式 | P2 语境感知；无法确定时 `preview` + 提示「该节点由表达式/循环生成」 |
| 性能 | 9 级定位 + 多候选读文件 | 定位只在命中候选后读文件；句柄缓存让重复操作 O(1)；搜索仍受 `maxScanFiles` 限制 |
| 幂等 journal 膨胀 | 长期运行 | 仅保留最近 512 条 + 按文件 revision 失效 |

**备选（若定位永远无法可靠）**：把结构编辑定义为「运行时覆盖」能力而非「源码写回」——保留现在的即时预览，同时在 `.dsh/nudge-overlays.json` 持久化操作，页面由插件重放；源码写回作为「显式导出」动作。这条路能 100% 稳定，但改变产品语义，建议只在 P2 评估。

---

## 14. 本轮验证结果（独立验收）

> 验收人：独立 verifier（不参与实现），只读 `plugin/src`、只写 `validation/` 与 `plugin/test/.tmp-verify/`。
> 证据：`plugin/test/.tmp-verify/report.md`、`validation/structure-cdp.mjs`（新增 `npm run test:structure`）。

| 门禁 | 结果 |
| --- | --- |
| `cd plugin && npm run build` | exit 0（runtime / index / source-sync / workspace / client 五个产物） |
| `cd plugin && npm test`（14 个脚本） | exit 0，14/14 通过 |
| `node test/source-sync.test.mjs` | **35 groups ok**（P0 新增 9 个结构组） |
| `node test/runtime-smoke.mjs` | **425 checks / 0 failures** |
| `node test/client-smoke.mjs` | 152 ok / 0 FAIL |
| 真实 Chrome e2e（`validation/structure-cdp.mjs`） | **64 PASS / 0 FAIL**，连续 3 次结果一致 |

关键 e2e 结论（真实 CDP 手势 → 真实 runtime → 真实 wire → 真实 Host）：

- 静态营销卡片删除（hint 指向 `demo/app.js`，即修复前的失败场景）：**SYNC 到 `demo/index.html`**，diff 只删除该卡片块。
- 样式卡垃圾桶删除、拖拽 move：**SYNC**，move 结果带 `handle`；用该 `handle` 重放同一 move 仍解析成功。
- JS 渲染的 `#dynamic-card-1`：**preview / `unsupported-js-source`**，0 次写盘、0 字节变化（结构编辑不再剪 JS/JSX）。
- 清理：无残留进程/端口/临时目录，`../demo` 未被写入。

## 附录 A：结构编辑可达 reason 全表

| reason | status | 触发点 | 普通页面概率 | 修复阶段 |
| --- | --- | --- | --- | --- |
| `no-source-mapping` | preview | `index.ts:302` | 高（非 loopback / cwd 不覆盖） | P0-1 |
| `unresolved-element` | preview | `locate.ts:60` | **很高**（hint 误导 / SPA shell / 动态 DOM） | P0-1/P0-2 |
| `ambiguous-element` | preview | `locate.ts:60` | 中（重复标记 + path 缺失/陈旧） | P1 |
| `path-mismatch` | preview | `locate.ts:59` | 高（JS 渲染 / 仅预览编辑之后） | P0-3/P1 |
| `protected-element` | preview | `markup.ts:353,370,385` | 低（选中 body/html） | P0-7（提示） |
| `unsupported-target-parent` | preview | `markup.ts:386-387` | 低中（拖进 script/textarea/自闭合） | P1 |
| `invalid-move-target` | preview | `markup.ts:391,393,409` | 中（锚点不在目标父级） | P1 |
| `unresolved-target-parent` | preview | `markup.ts:383` | 高（错文件）→ 中（无 path 转发） | P0-1/P1 |
| `unresolved-target-anchor` | preview | `markup.ts:406` | 中（重复/空锚点） | P1 |
| `invalid-edit` | preview | `index.ts:178` + `validate.ts:37-59` | 低 | P1 |
| `unsafe-js-context`（新增） | preview | P0-4 闸门 | 中（JSX 条件子节点） | P0-4 |
| `stale-handle`（新增） | 降级重试 | P1 会话层 | 中 | P1 |
| `unsupported-source-type` | preview | `index.ts:301` | 中低 | P0-1 |
| `read-only-policy` | preview | `index.ts:50-55` | 取决于会话沙箱 | — |
| `file-too-large` / `file-missing` / `read-failed` / `write-failed` / `stale-version` / `internal-error` | failed | `index.ts` 各处 | 低 | — |

## 附录 B：文档修订清单

| 文件 | 问题 | 状态 |
| --- | --- | --- |
| `docs/source-sync.md` 策略表 | 缺 `html-remove` / `html-move` | ✅ 本轮已补两行（含整行清理、缩进、拒绝条件） |
| `docs/source-sync.md` reason 列表 | 缺 6 个结构 reason | ✅ 本轮已补齐并指回本文矩阵 |
| `docs/source-sync.md` Known limitations | 未提结构编辑 | ✅ 本轮已增「结构编辑：hint 误导不回退、SPA shell、JSX 拒写、重放语义」并链接本文 |
| `docs/source-sync.md` path 描述 | 称 `path` 不用于定位（错） | ✅ 本轮已改为「last-resort locator，且只在 DOM 与源码同构时有效」 |
| `README.md` 功能/使用 | 未记录删除元素与拖动调整 | ✅ 本轮「编辑」小节补结构编辑两条 + 同步语义与本文链接 |
| `docs/ACCEPTANCE.md` | 无结构编辑验收项 | ⬜ 待按 §11 的 CDP 用例补 |
| `locale/*.json` + `body.tsx:142-201` | 中文缺 `designDelete*` 转发 | ⬜ 待转发 3 个键（同步更新 `test/runtime-smoke.mjs:1303-1304` 的英文兜底断言） |

## 附录 C：证据索引

- 真实 CDP 复现：`plugin/test/.tmp-repro/findings.md`（11 场景矩阵 + payload 原文 + 写盘 diff + `D-reapply-not-idempotent` 小节）；脚本 `repro-structure-sync.mjs`。复跑：先 `node validation/serve-demo.mjs`，再 headless Chrome `--remote-debugging-port=9223`，然后 `node plugin/test/.tmp-repro/repro-structure-sync.mjs`。
- Host 探针：`plugin/test/.tmp-audit/findings.md`（18 条 finding、Q1–Q9 回答、reason 矩阵、27 组 probe 表）；脚本 `probe{,2,3,4,5}.mjs`。
- 关键代码位置：`10-card.ts:773-839`（采集/触发）、`10-handlers.ts:124,147,256-262`（手势）、`body.tsx:679-739,785-832`（队列/重放/撤销）、`sync-queue.ts:32-151`（合并/状态）、`index.ts:173-442`（路由/补丁分发）、`locate.ts:33-253`（阶梯）、`markup.ts:348-467`（结构补丁）、`validate.ts:11-59`（kind/形状）、`constants.ts:18`（扩展名白名单）。
- 注意：`test/.tmp-*` 是临时证据目录（已被 `.gitignore` 的 `test/.tmp-*/` 覆盖），不随仓库发布；如需长期保留，请把矩阵与探针脚本迁入 `test/` 作为正式回归。
