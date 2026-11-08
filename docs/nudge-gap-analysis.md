# Nudge 标注交互差距分析（对齐 Codex 桌面端浏览器选择体验）

> 审计对象：`dsh.nudge` 0.1.0（DSH Desktop 原生插件 + 右侧边栏 webview + 注入页面运行时）
> 审计方式：**只读**代码审计 + 现有工程测试 + `docs/evidence/` 截图；未修改 `src/`、`lib/`、`test/`、`locale/`。
> 审计时间：2026-11-06 23:48–24:00（Asia/Shanghai）
> **领域目录重构（2026-11-07 20:40 之后）**：`src/` 已按业务域重排（`client/domains`、`client/platform`、`client/shared`、`client/ui`、`host/domains/persistence`、`runtime/domains`）；本文中的旧路径（如 `src/client/00-core.js`、`src/runtime/inspector-runtime.js`）与行号均指重构前快照，仅作历史对照。

> 说明：审计期间 Lead 正在并行落地 P0。本文用 **B0（P0 前基线）** 描述插件原始交付态，用 **S1（并行实现观察快照）** 记录 23:58 时已落地的部分；行号会随并行修改漂移，定位以函数名为准。

> **Lead 最终落地补充（2026-11-07 00:10）**：在本文 S1 快照之后，Lead 又完成了：`annotationAccent=#0069FB` / `annotationMarker=#339cff` 双 token、26px 可点击 pin marker（hover 1.08、左下 3px 尖角）、region 2px dashed、composer 22px 圆角（对齐 Codex 实测）、Space modifier/IME/repeat guard + Esc 退出 + CSP `adoptedStyleSheets` 兜底；`runtime-smoke` 最终 **206/206**。本文中标为“仍缺”的对应项请以该补充为准；文字选择、Shift 多选、top-layer 仍为 P1/P2。
> **骨架重构（2026-11-07 00:20）**：三模式 Segmented 已替换为 Codex 式「批注 / 编辑」双开关；编辑模式改为页面内浮动样式卡（颜色 / 背景 / 透明度 / 字体 / 字号 / 字重），标注 Composer 右上角滑杆可直接切到该卡；设计改动以 `design-style` 事件回传宿主，复用历史与源码同步。
> **骨架二次重构（2026-11-07 00:40）**：工具栏保留「标注 / 编辑」双入口；标注 Composer 改为深色 24px 胶囊（滑杆 / 输入 / 关闭 / 提交），保存后进入页面左下角浮动评论卡与底部「正在批注 · N」条；支持拖选文字生成 `textSelection` 批注；编辑入口与 Composer 滑杆共享深色 22px design card；右侧旧 Dock / 标注列表 / 属性面板已整体删除。`runtime-smoke` 最终 **206/206**。

---

## 0. 结论摘要

1. **交互骨架已经完整**：三模式（浏览 / 标注 / 编辑）、点击选中、拖拽框选、区域标注、编号 badge、就地 popover、标注列表、定位闪烁、发送给 Agent 都已可用，且有 **runtime-smoke 195（收尾时 198）+ runtime-cdp 99** 条检查覆盖基础路径（B0 的 runtime-smoke 为 187、cdp 为 99；S1 新增 8 条 runtime-smoke 断言，收尾时累计 +11；cdp 在 S1-latest 复跑仍 99/99）。
2. **与 Codex 的核心差距不在“能不能”，而在“手感与信息密度”**：
   - 模式模型：Codex 是 **单个 Annotate 开关**（Browse ⇄ Annotate），插件是 **三段式 Segmented**，且“编辑”与“标注”语义混杂；
   - 临时接管：Codex **按住 Space 临时把页面交还用户**，B0 没有；S1 已实现运行时逻辑但缺提示与边界硬化；
   - 光标语言：Codex 有 **comment bubble / add 十字 / text 光标** 三态定制光标，B0 是系统箭头；S1 已做 26px 气泡，但只有一态；
   - 选择框：Codex 是 **2px `#0069FB` + 3% 填充 + 1px 内白描边**，B0 是 2px 主题色、无填充、无内描边；S1 形态已对齐，**23:59 已引入 `annotationAccent` token，颜色对齐 `#0069FB`**；
   - marker：Codex 是 **26px 编号 pin（可点击、hover 放大 1.08）**，B0 是 18px 圆角 pill，S1 是 24px 水滴但 **不可点击、无 hover**；
   - metadata tooltip：Codex 在 **元素原点**浮出 2 列 metadata 卡（tag / size / color / font，带 label），B0 没有；S1 已改为 **元素原点锚定**（23:57 观察），仍 **无 label、无缓存**；
   - composer：Codex 是 **单行可扩展、暗色**；B0 是 300px 表单（标题 + 副标题 + 3 行 textarea）；S1 已改 340px/18px 圆角/Enter 提交/自动增高，**仍非单行初始态、键盘提示改为符号但未走 locale**。圆角规格存在冲突：任务描述为 26px，task-1 逆向证据显示评论卡片实为 **22px**（`rounded-[22px]`），26px 是 marker/cursor 尺寸 —— **以产品/截图最终确认为准**；
   - 文字选择批注、Shift 多选、coachmark：B0/S1 均未实现。
3. **测试基底健康，Space/选择框已有覆盖**：`runtime-smoke` **195/195（收尾时 198/198）**（S1 新增 selection chrome + space passthrough 8 条）、`client-smoke` 18/18、`runtime-cdp` 99/99 全通过；但 **光标位置/三态、metadata tooltip、marker 交互/动效、composer 行为、reduced motion、颜色 token 仍无测试断言**，P0 落地后必须补。
4. **P0 建议严格按“低风险高收益”推进**：先做 **强调色 token（`#0069FB`）+ Space 硬化 + 光标单态+边界 + marker 可点/动效 + tooltip 信息结构 + composer 单行扩展**；这些全部集中在 `src/runtime/inspector-runtime.js` 一个文件内，不改宿主通信协议，不同步源码，回滚成本低。

---

## 1. 审计范围、快照与证据

### 1.1 读取的文件

| 文件 | 角色 | 审计时行数 | SHA-256（前 12 位） |
| --- | --- | --- | --- |
| `src/runtime/inspector-runtime.js` | 注入页面的全部 UI/交互（约 2200 行） | B0: 1812；S1-early: 2078；S1-latest: 2207 | B0 无留存；S1-latest `c510d444a1d3` |
| `src/client/30-toolbar.js` | 宿主 40px 模式工具栏（Segmented 三模式） | 113 | `464c28eeae08` |
| `src/client/55-annotation-panel.js` | 标注列表 Dock + composer 旁 chip | 230 | `b3a15f9864f7` |
| `src/client/60-body.js` | Tab body：轮询 runtime 事件、模式下发、Dock、发送 | 1023 | `fda4b635c65d` |
| `src/client/00-core.js` | tab 状态、主题 token 桥、agent prompt | 610 | `27a8c13c9ef1` |
| `src/client/10-carrier.js` | webview/iframe carrier、`setMode`/`drainEvents` 桥 | 468 | `552da586f62b` |
| `src/client/20-primitives.js` | Segmented / IconButton / Badge 等视觉原语 | 571 | `2b29809426a9` |
| `src/client/65-browser-entry.js` | Browser 引导卡与 Tab 菜单入口 | 301 | `4511dd6c8e3a` |
| `src/client/70-register.js` | Tab / 快捷键 / composer 入口注册 | 226 | `341115122018` |
| `locale/zh.json`、`locale/en.json` | 全部文案（各 156 行） | 156 | `f193da0a9ac4` / `096cd5c3f63e` |
| `test/runtime-smoke.mjs` | 运行时纯 DOM 冒烟（B0 187 / S1 195 / 收尾 198 checks） | B0: 1259；S1: 1283（收尾继续增长） | `2eaf634ef112`（收尾已变） |
| `test/client-smoke.mjs` | Client bundle 注册冒烟（18 checks） | 139 | `2d6aa3f6e495` |
| `test/runtime-cdp.mjs` | 真实 Chromium CDP 集成（99 checks） | — | `18961e8a70f0` |
| `docs/ACCEPTANCE.md`、`docs/evidence/*.png` | 既有验收结论与真实窗口截图 | — | — |

### 1.2 三个时间点的快照

| 名称 | 时间 | 文件形态 | 用途 |
| --- | --- | --- | --- |
| **B0** | ≤ 23:49 | runtime 1812 行，无 cursor/meta/draft/passthrough | 差距矩阵的“现状”基准（P0 前的交付态） |
| **S1-early** | 23:50:46 | runtime 2078 行，hash `c0db79980f61`，已有 cursor/meta/draft/动效 | 冻结快照 `/tmp/vi-audit-snapshot`，用于复测基线 |
| **S1-early** | 23:50:46 | runtime 2078 行，hash `c0db79980f61`，已有 cursor/meta/draft/动效 | 冻结快照 `/tmp/vi-audit-snapshot`，用于复测基线 |
| **S1-latest** | 23:59 | runtime 2207 行，hash `c510d444a1d3`（含 P0-0 `#0069FB` token）；`runtime-smoke` 195 checks | 并行实现进度观察（附录 B） |

> 并行实现说明：审计期间 `src/runtime/inspector-runtime.js` 被 Lead 持续修改（1812 → 2078 → 2207 行）。**本文的 S1-latest 冻结于 `c510d444`（23:59，含 P0-0）；收尾时 live 仍在继续演进（行数与 hash 已超出该快照）**，后续增量未纳入本文，P0 状态请以验收清单重新勾验。本文把 B0 作为“升级前现状”，把 S1 作为“已落地进度”，**不把 S1 已完成项当成缺口**。

### 1.3 证据边界（observed / inferred / unknown）

- **observed**：插件源码、locale、测试代码、`docs/evidence` 截图；本机 `/Applications/ChatGPT.app` 解包出的 Codex preload / webview 资源（`/tmp/codex-extract`）。
- **inferred**：由 CSS/JS 数值推得的交互意图（如“按住 Space 临时接管”的含义）；任务给定的 composer 26px 圆角等规格（task-1 证据指向 22px，见 §4.2 注）。
- **unknown**：Codex 评论 composer 的最终圆角值（本机静态包未直接定位；task-1 结论为 22px，任务描述为 26px，**两者冲突，需以截图/产品确认为准**）；Codex 的某些 Esc/焦点细节；本插件在真实 DSH Desktop 中的手工手感（本次未做人工实机操作，使用既有截图 + 测试）。

---

## 2. 当前交互状态机（B0 基线）

### 2.1 三种模式

模式的事实来源是 Client store 的 `tab.mode`（`src/client/00-core.js:ensureTab` 默认 `'browse'`），由 `NudgeBody` 的 effect 下发：

```
tab.mode ──(React effect, 60-body.js:189-196)──> carrier.setMode(mode)
        ──(carrier.runtimeCommand, 10-carrier.js:381-384)──> runtime r.setMode(mode)
```

Runtime 侧 `MODES = { browse, annotate, edit }`，非法值返回 `false`（B0/S1 同）。

| 模式 | 页面原生交互 | hover 高亮 | 点击 | 拖拽 | popover | 右侧 Dock |
| --- | --- | --- | --- | --- | --- | --- |
| `browse` | 保留 | 无 | 不拦截；仅关闭 popover | 无 | 无 | 属性面板（若有选择残留则显示；切 browse 时 client 主动 `clearSelection()`） |
| `annotate` | 被拦截 | 有（1px→S1 2px） | 选中 + 打开“添加标注” | 空白处拖拽 → 区域框选 → 区域 popover | 有 | 替换为「网页标注」列表 |
| `edit` | 被拦截 | 有 | 选中，**不打开 popover** | 无 | 无 | 样式 / 内容 / DOM 三 Tab |

补充：

- 切到 `browse` 时：runtime `setMode` 清 `hoverEl`、取消 `drag`、关闭 popover、`updateVisuals`；Client 再调 `clearSelection()`。
- 切到 `annotate` / `edit` 时：`ensureOverlay()` 创建覆盖层（若尚未创建）。
- 任何模式下点击 overlay 自身都不算页面点击（`isOverlayEvent` + `composedPath`）。

### 2.2 页面事件管线（全部 capture）

`attachListeners()`（B0/S1）：

| 事件 | 处理器 | 关键行为 |
| --- | --- | --- |
| `click` | `onDocumentClick` | browse 直接返回；非 browse 拦截 `preventDefault/stopPropagation`，`composedTarget` 选中目标，annotate 打开 popover；区域拖拽后有 450ms `suppressClickUntil` |
| `mousedown` | `onDocumentMouseDown` | 仅 annotate：记录 `drag` 起点（用于区分 click / drag） |
| `mousemove` | `onDocumentMouseMove` | S1：更新 pointer 坐标；drag 累积位移 > 8px 激活 marquee；非拖拽时更新 `hoverEl`（非 overlay） |
| `mouseup` | `onDocumentMouseUp` | 完成框选：宽高 < 2px 忽略；否则 `region-select` + 打开区域 popover；450ms 内抑制后续 click |
| `mouseout` | `onDocumentMouseOut` | `relatedTarget` 为空时清 hover |
| `keydown` | `onKeyDown` | B0：Esc 关 popover / 取消 drag。S1：Space 按住进入 passthrough；Esc 关 popover |
| `scroll` / `resize` | `onScroll` / `onResize` | `visualNeeded()` 时 `scheduleFrame()` |
| `popstate` / `hashchange` | `checkPageInfo` | 队列 `page-info` |

另有：

- `MutationObserver`（childList/subtree/characterData）→ `schedulePageCheck()` + 需要时重绘（用于 SPA / 弹窗 DOM 变化）。
- `history.pushState/replaceState` 打补丁 → `page-info`（SPA 导航）。
- 事件队列 `events` 上限 400；Client 每 **170ms** 轮询 `drainEvents()`（`60-body.js:152-154, 209-216`）。

### 2.3 状态变量（runtime 闭包）

| 变量 | 含义 | 备注 |
| --- | --- | --- |
| `mode` | 当前模式 | 三值；唯一由 `setMode` 修改 |
| `hoverEl` | 悬停元素 | browse 为 null；popover 打开时不显示 hover |
| `selectionEl` / `selectionSelector` | 当前选中元素 / CSS 选择器 | 断连时 `selection-lost` |
| `drag` | `{startX,startY,x,y,active,target}` | 仅 annotate；8px 阈值；active 才画 marquee |
| `suppressClickUntil` | 拖拽结束后抑制 click 的时间戳 | +450ms |
| `popover` | `{wrap,title,subtitle,textarea,cancel,add,draft}` | 同一时刻最多一个 |
| `annotations` / `annotationEls` | 标注数组 / id→元素缓存 | badge 编号 = 数组下标 + 1 |
| `flashTarget` / `flashTimer` | `locate()` 的 650ms 闪烁 | scrollIntoView + 填充框 |
| `theme` / `locale` | 运行时主题 / 文案 | `setTheme` / `setLocale` 可热更新 |
| `root` / `layer` / `parts` | 覆盖层 DOM / ShadowRoot / 部件表 | Shadow DOM（`mode:'open'`） |
| `rafId` / `frameQueued` | 合并帧 | 用 rAF，降级 setTimeout(16) |
| `suspended` / `destroyed` | 生命周期 | 重注入先 `destroy()` 旧实例 |
| `passthrough`（S1） | Space 临时接管 | 新增 |
| `pointerX/Y`、`pointerSeen`（S1） | 指针位置/是否出现过 | 新增 |
| `cursorStyleEl`（S1） | 隐藏系统光标的 `<style>` | 新增 |

### 2.4 两条主交互时序

**A. 点击标注（annotate）**

```
mousedown (doc capture) ──> drag={start, target}
mouseup                 ──> drag.active=false, scheduleFrame
click (doc capture)     ──> preventDefault/stopPropagation
                            composedTarget(event)  →  target（穿透 shadow）
                            selectElement(target, emit=true)
                              ├─ selectionEl = target
                              ├─ selectionSelector = cssPath(target)
                              ├─ ensureOverlay()
                              ├─ queueEvent('select', {descriptor})
                              └─ updateVisuals()（selection 2px + badge 重排）
                            mode === 'annotate' && openPopover({element: target})
                              ├─ buildPopover(draft)
                              ├─ applyPopoverTheme/Locale
                              ├─ positionPopover()（优先上方，其次下方，边缘 clamp）
                              └─ textarea.focus() + 光标置尾
```

**B. 拖拽框选（annotate）**

```
mousedown → drag.start
mousemove → 位移 > 8px → drag.active=true → 绘制 marquee（dashed）
mouseup   → width/height ≥ 2px
            → normalizeRegion
            → elementAtPoint(中心) || 起点 target || body
            → queueEvent('region-select', {region, selector, descriptor})
            → openPopover({element, region})
            → suppressClickUntil = now + 450ms
提交 → annotation.region = {x,y,width,height}；badge 画在区域左上角
```

### 2.5 事件协议（runtime → client）

| type | payload | 触发 | Client 行为（`60-body.js:218-247`） |
| --- | --- | --- | --- |
| `page-info` | `{url,title}` | boot / 导航 / SPA | 更新 tab.url/title |
| `select` | `{descriptor}` | 页面点击选中 | 更新 `tab.selection`、刷新 DOM 树 |
| `selection-lost` | `{selector}` | 选中元素被移除/重渲染 | 清空 selection |
| `region-select` | `{region,selector,descriptor}` | 框选完成 | **B0 Client 未处理该事件**（仅 popover 内部 draft 保存；事件被忽略） |
| `annotate-add` | `{annotation}` | popover 提交新增 | 追加到 `tab.annotations` |
| `annotate-update` | `{annotation}` | popover 编辑提交 | 替换对应标注 |
| `annotate-remove` | `{id}` | **runtime 从不发送** | Client 有处理分支，但依赖本地乐观删除；runtime `removeAnnotation` 不发事件（一致性缺口） |

> 发现：`region-select` 在 Client 侧没有消费分支；`annotate-remove` 是“写了但永远收不到”的协议分支。前者不影响功能（popover 持有 draft），后者在多端/外部删除时会不同步。建议在 P1 清理协议（要么 runtime 发 `annotate-remove`，要么删掉 Client 分支）。

### 2.6 键盘与焦点（B0）

| 键 | 上下文 | 行为 |
| --- | --- | --- |
| `Escape` | 页面任意位置（capture） | 有 popover → 关闭并阻止冒泡；否则取消 drag |
| `Cmd/Ctrl+Enter` | popover 内 | 提交 |
| `Escape` | popover 内 | 关闭（popover 自身 keydown + runtime capture 双保险） |
| 其余键 | — | 无处理；页面原生行为（除被 click 拦截外） |

焦点：popover 打开后 `textarea.focus()` 并置光标到末尾；**无 focus trap、无 focus 恢复**；标注 marker（badge）是 `aria-hidden` 的 div，不可聚焦。

**S1 新增**：按住 `Space`（且不在 popover、不在 input/textarea/contenteditable/[role=textbox] 等编辑目标上）→ `setPassthrough(true)`；`keyup` 或窗口 `blur` → `setPassthrough(false)`。详见 P0-1。

### 2.7 生命周期

- 注入即 `boot()`：挂 listener、观察 DOM、打补丁 history、发 `page-info`。
- 再次注入：先 `destroy()` 旧实例 + 移除残留 `[data-dsh-nudge-root]`；`runtime-smoke` 已验证 listener 数不增、overlay 唯一。
- `destroy()`：解绑所有 listener/observer、清 timer、关 popover、移除 root、恢复 history。
- 页面导航：webview `did-finish-load` 后 Client `restoreRuntime()` 重新注入 runtime，并按 history 重放 edits（`60-body.js:257-270`）。

---

## 3. 当前视觉规格

### 3.1 主题与 token 来源

- 宿主 Dock：`readTheme()` 读取 `--dsw-alias-*`（`00-core.js:280-304`），Light/Dark 由 `base` 亮度推断 `isDark`。
- 页面运行时：`themePaletteForRuntime()` 把宿主主题映射为 `{accent: brand, panelBg: overlay, text, border, muted, danger, isDark}`（`00-core.js:315-325`）。
- **B0 默认强调色 = `#4f8cff`（runtime DEFAULT_THEME）/ 宿主品牌色（实际约 `#6b9dff`）**；**不是 Codex 的 `#0069FB`**。
- 字体：`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`；中文回退在 S1 composer 补了 `"PingFang SC"`。

### 3.2 覆盖层与 z-index

- `root`：`position:fixed; left/top 0; width/height 0; z-index:2147483647; pointer-events:none; aria-hidden:true`，挂 `document.documentElement`（失败回退 body）。
- `layer`：open ShadowRoot（避免页面 CSS 干扰）。
- B0 部件层级（shadow 内）：region `z1` → marquee `z2` → badge `z3` → popover `z6`（`POPOVER_Z`）；flash 无显式 z。
- S1 新增：draft `z5` → meta `z7` → cursor `z8`。
- **关键工程缺口**：根节点没有进入浏览器 **top layer**。页面里原生 `<dialog showModal>`、`popover`、全屏元素会盖住覆盖层（Codex 用 `popover="manual"` 的 interaction-layer 解决）。`docs/ACCEPTANCE.md` 的多级弹窗是页面自绘 div，才没有暴露该问题。

### 3.3 部件规格对照（B0 / S1 / Codex）

| 部件 | B0（原始交付态） | S1（23:58 观察） | Codex 参考（observed） |
| --- | --- | --- | --- |
| hover 框 | 1px accent 实线，radius 3，无填充，无内描边 | **2px** accent，填充 accent 3%，内描边 `inset 0 0 0 1px rgba(255,255,255,.22)`（亮色 .72），radius 跟随元素（`radiusOf`，0–24px），opacity 过渡 150ms | 2px `#0069FB`，填充 3%，内描边白 28%，radius 0（或元素 radius），opacity 150ms |
| selection 框 | 2px accent 实线，radius 3，无填充 | **2px** accent，填充 3.5%，内描边白 26%（亮色 78%），radius 跟随元素 | 同 hover-box 规格（2px `#0069FB` + 3% + 内白描边） |
| marquee（框选） | 1px accent 虚线，填充 12% | **2px** dashed，填充 10% | `.region-box` 2px dashed；posted region 3% |
| 区域标注框 | 1px accent 虚线，填充 8%，radius 3 | 1px dashed，填充 8%（未升级到 2px） | dashed 2px，posted region 3% |
| 标注 badge / marker | 18px 高 pill（`minWidth 18`，`padding 0 5`，radius 999），白边 `rgba(panelBg,.9)`，`600 11/16`，阴影 `0 2px 6px .25`，位于 `box.left-9 / box.top-9`，`pointer-events:none` | 24×24 水滴（`50% 50% 50% 4px`），白边 1.5 `.94`，`700 11/21`，`left-12/top-12`，`z4`，阴影 `0 4px 10px .28`，`transform` 过渡 150ms；仅“正在编辑的标注”`scale(1.08)` | 26×26 编号 pin（saved/draft 同尺寸），白色编号 `11px/700`，水滴底形，hover/selected `scale(1.08)`，origin bottom-left，150ms，**可点击**（button，aria-label “Browser comment N”） |
| draft marker | 无 | 26px 水滴 + `•`，位于锚点 `left-13/top-13`，`z5`，popover 打开时显示 | draft-marker 26px，文本选择激活时隐藏 |
| 定制光标 | 无（系统箭头） | 26px 气泡（accent 填充 + 白描边 1.65 + drop-shadow），hotspot 左下，`z8`，**仅 annotate 模式**且无 popover/passthrough/drag 时显示（23:57 收敛）；同时用 `<style>{html,body,body *{cursor:none!important}}</style>` 隐藏系统光标 | 26×26，`#339cff` 填充 + 白描边 1.65；三态：add（+ 十字，hotspot center）、comment（气泡，hotspot (0,26)）、text（I-beam+气泡缩小 .55，beam 显示） |
| hover metadata tooltip | 无 | 元素原点上方（`rect.top - height - 8`，空间不足放下方），min 154 / max 250，padding 7/9，radius 8，11px，`z7`；第一行 `tag + W×H`，第二行 `color · fontFamily fontSize`；popover/passthrough/drag/browse 时隐藏 | 元素原点浮层，`grid 2 列`，高 72，radius 12，padding 10/8，13px/1.25；行：tag、size、**label “color” + 值**、**label “font” + 值**；值等宽右对齐；白底 / 暗色 `rgba(15,23,42,.95)`；`pointer-events:none` |
| popover / composer | 300px 宽，padding 10，radius 10，1px border；标题 12.5/600 + 副标题 11；textarea `rows=3` min 64 / max 180、radius 6；按钮 radius 6、padding 4/10；Cmd/Ctrl+Enter 提交；无动画 | 340px 宽，padding 0，radius **18**，标题 13/600 + accent 圆点 8px + 副标题 `tag · W×H`；textarea min 72 / max 180、radius 12、inset 背景、resize none；Enter 提交 / Shift+Enter 换行 / 空值禁用 Add；按钮 28px 高（Add 为 999 pill）；提示 `↵ · ⇧↵`（符号，未走 locale）；入场动画 160ms `cubic-bezier(.23,1,.32,1)` translateY(5px) scale(.985) | 单行可扩展 composer，暗色；**圆角 22px**（task-1 证据：评论卡片 `rounded-[22px]`；26px 是 marker/cursor 尺寸，任务描述的 26px 待确认）；Enter 提交 / Shift+Enter 换行；尺寸小于桌面表单式面板 |
| flash（locate） | 2px accent + 18% 填充，650ms 后消失 | 同 B0 | （Codex 无完全对应；有元素 preview/scroll 行为） |
| 动画 | **无** | hover opacity 150ms；badge/draft transform 150ms；popover 160ms；`prefers-reduced-motion` 仅覆盖 popover/badge/draft | 统一 **150ms `cubic-bezier(.23,1,.32,1)`**，覆盖 hover-box / cursor / marker / draft；`prefers-reduced-motion` 全部关闭 |
| 覆盖率/无障碍 | overlay `aria-hidden`；badge `aria-hidden` 不可聚焦；popover `role=dialog`（无 `aria-modal`），无 focus trap/restore | 同 B0 + `aria-modal=false` | marker 是 `<button>` 带 aria-label；interaction-layer 用 `popover=manual`；tooltip `pointer-events:none` |

### 3.4 宿主 Dock 视觉（与选择体验相关的部分）

- 工具栏（`30-toolbar.js`）：高 40px，底部 1px 分割线；导航 IconButton 28px；地址输入 28px 高、radius 6；**模式 Segmented 三段**：浏览 / 标注 / 编辑，按钮高 24px、radius 6，激活底 `layer2` + 600 字重；后接撤销/重做/面板开关。
- Dock（`60-body.js`）：默认宽 320（clamp 280–480，可拖拽）；DockHeader 显示当前选择 `tag#id`/selector；`annotate` 模式整个 Dock 换成 `AnnotationPanel`。
- 标注列表（`55-annotation-panel.js`）：卡片 `border-left: 2px brand`（stale 用 danger）、radius 8、`#N` Badge、标题取文本前 28 字/标签、正文 12px、操作按钮 22px；底部“发送给 Agent”。
- 标注模式底部条：高 36px，`已添加 N 条标注` + 查看标注 + 发送。
- 底部状态条：高 22px，显示 `shortLabel(selection)` + 模式提示 + Workspace/只读 Badge；annotate 提示为「悬停高亮元素，点击添加标注；在空白处拖拽可框选区域」。
- composer 旁 chip（`ComposerAnnotationChip`）：标注数 > 0 时出现，24px 高、pill、`标注 ×N`，点击打开检查器。

### 3.5 文案与 i18n 现状

- 已有中英双语：`toolbar.*`、`mode.*Hint`、`annotation.*`、`composer.*`、`address.*`。
- 运行时 popover 文案通过 `carrier.applyPreferences` → `r.setLocale()` 热更新（`10-carrier.js:228-238`）。
- **缺口**：S1 composer 的键盘提示是硬编码符号（`'↵ · ⇧↵'`，未走 locale）；Space 临时接管、tooltip 的 `color/font` label、光标语义均无文案；coachmark 无文案。

---

## 4. Codex 参考规格（本机静态证据）

> 证据路径：`/tmp/codex-extract`（由本机 `/Applications/ChatGPT.app` 解包）。task-1 已产出独立报告 `docs/codex-browser-selection-teardown.md`（2026-11-07 00:00），本文与其交叉核对，Codex 侧细节以其为准。

### 4.1 交互模型

| 能力 | 证据 | 规格 |
| --- | --- | --- |
| 单 Annotate 开关 | `browser-page-preload.pretty.js:23304,23337` 等 `"comment" === ev` / `"browse" === ev` 分支 | 运行时只有 browse / comment 两态；工具栏层是单个 Annotate toggle（与插件三模式不同） |
| 点击 vs 拖拽 | 23337-23410；指针位移阈值 | 点击选元素；拖拽画 region；拖拽结束抑制 follow-up click |
| Space 临时接管 | 23345-23360、23371 | **trusted keydown Space**：非 repeat、无 alt/ctrl/meta/shift、非输入框/`contenteditable`/`[data-codex-composer]`/`[data-codex-terminal]`，`preventDefault + stopImmediatePropagation`，通知 host “suspended”；keyup 恢复；window blur 复位 |
| Shift 多选 | 23600-23690、23990-24020 | `canUseAnnotationMultiSelect` 为真时，Shift+click 进入多选/追加；modifier 状态同步 host |
| 文字选择批注 | 20279、25382、25890-26030 | `Range` 选择生成 `.text-selection-highlight`（`#128dff66`）；把 `selectedText` / text locator 交给 host；text 光标模式 |
| 关闭/取消 | 23337 前后 | 点击空白、Esc 等关闭 composer / 退出当前注释流程（细节待 task-1） |
| coachmark | webview 资源（`--color-background-coachmark`，36×14 / 14×36 notch） | 首次使用引导，带底部小尖角 |

### 4.2 视觉与动效

| 项 | 证据行 | 精确值 |
| --- | --- | --- |
| 强调色 | 20239-20240 | `nO = "#0069FB"` |
| 缓动 | 20239 | `nz = [0.23, 1, 0.32, 1]`，即 `cubic-bezier(.23,1,.32,1)` |
| hover-box | 20276-20277 | `border:2px solid #0069FB; background: color-mix(in srgb,#0069FB 3%,transparent); box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); border-radius:0; transition: opacity 150ms cubic-bezier(.23,1,.32,1)` |
| 文字选择高亮 | 20279 | `background:#128dff66` |
| region | 20294-20296 | `.region-box{border-width:2px;border-style:dashed}`；posted region 3% |
| marker | 20300-20307、25284-25293 | `marker` 26×26（`E.QH=26`），`saved/draft-marker` 同尺寸；label `11px/700`；hover/selected `scale(1.08)`，origin bottom-left，150ms；`pointer-events:auto` |
| 光标 | 20247-20272、20284-20292 | 26×26；fill `#339cff`；stroke white 1.65；add/comment/text 三态 hotspot；text 模式 bubble `translate(...) scale(.55)` + beam 显示；comment 模式 `cursor:none` |
| metadata tooltip | 14368-14423、20440-20520、25284-25293 | 2 列 grid（`minmax(56px,auto) minmax(0,1fr)`），高 72，radius 12，padding 10/8，13px/1.25；tag / size / label “color” + value / label “font” + value；值等宽右对齐；白底/暗色；`pointer-events:none`；锚定元素 rect |
| composer | task-1 报告：评论卡片 `rounded-[22px]`（`802294:2793-2794`）；26px 实为 marker/cursor 尺寸；任务描述写 26px → **22 vs 26 待确认** | 单行、可扩展、暗色；圆角以产品/截图确认（证据倾向 22px）；Enter/Shift+Enter |
| coachmark | webview 资源 `--color-background-coachmark` | 底部 notch（36×14 或旋转 14×36），配合 hint/coachmark 组件 |

> **证据冲突（composer 圆角）**：任务说明写 composer 26px；task-1 逆向报告（`docs/codex-browser-selection-teardown.md`，证据 `802294:2793-2794`）指出评论卡片是 `rounded-[22px]`，而 **26px 是 marker/cursor 的尺寸常量**（`E.mC.width=26`）。因此本报告把 26px 标为 inferred/待确认，P0-5 建议先按 22px 实现并与 Codex 截图对比；如产品确认 26px 再调整。

### 4.3 工程边界（Codex 已处理，插件需评估）

- **top layer**：interaction-layer 使用 `popover="manual"`（`browser-page-preload.pretty.js` 20520 行附近 `popover:"manual"`），避免被页面 `<dialog>`/全屏元素覆盖。
- **zoom / visualViewport**：overlay 使用 `zoomFactor` 补偿（25280-25300），固定定位按缩放换算。
- **iframe / shadow DOM**：text locator 与 selection 有跨 frame 处理（25890-26030）。
- **reduced motion**：每个过渡都有 `@media(prefers-reduced-motion:reduce)` 关闭。
- **焦点/键盘**：marker 是 button，可键盘触达；composer 区域有明确的 typing guard（避免 Space/快捷键劫持输入）。

---

## 5. 差距矩阵

评级：**P0** = 本轮低风险高收益；**P1** = 下一轮高价值；**P2** = 增强/边界。状态以 B0 为准，S1 进度见括号。

### 5.1 交互模型

| # | 能力 | Codex | 插件 B0 | 差距 | 级别 |
| --- | --- | --- | --- | --- | --- |
| C1 | 模式开关 | 单个 Annotate toggle（Browse ⇄ Annotate） | 三段 Segmented（浏览/标注/编辑） | 模式多、心智负担高；“标注/编辑”并列但目标不同；切 browse 会清选择 | P1 |
| C2 | 点击选中 | 点击元素 | 支持（annotate/edit） | 一致 | — |
| C3 | 拖拽框选 | 拖拽区域 | 支持（仅 annotate），8px 阈值 | 一致；但区域记录的是视口坐标，滚动后不跟随（已知限制） | P1 |
| C4 | Space 临时接管 | 按住 Space 把页面还给用户 | **无**（S1 已实现运行时逻辑） | B0 无法在不切模式的情况下点页面按钮/滚动链接；S1 仍缺提示与边界硬化 | **P0** |
| C5 | 键盘 | Space / Shift 多选 / Esc 等 | 仅 Esc（+ 编辑态 Cmd/Ctrl+Enter） | 缺 Space、Shift、marker 键盘操作 | P0/P1 |
| C6 | marker 交互 | marker 可点击、hover 放大、批量导航 | badge `pointer-events:none` | 无法点 badge 回到对应标注；无 hover 反馈 | **P0** |
| C7 | 多选标注 | Shift+click 多元素，批量 composer | 无 | 一次只能标注一个元素/区域；跨元素意见要多次添加 | P1 |
| C8 | 文字选择批注 | 选中文字 → 批注选中文本 | 无（拖拽只会框选区域） | 文案修改类需求无法精确指向文本 | P1 |
| C9 | coachmark | 首次引导 | 无 | 新用户不知道 Space / 拖拽 / 发送 | P2 |

### 5.2 视觉

| # | 能力 | Codex | 插件 B0 | 差距 | 级别 |
| --- | --- | --- | --- | --- | --- |
| V1 | 强调色 | `#0069FB` | 宿主 brand（约 `#6b9dff`） | B0 与 Codex 不一致；S1 23:59 已引入 `annotationAccent` 默认 `#0069FB`，仅缺对比度/单测 | **P0**（S1 已做） |
| V2 | 选择框 | 2px + 3% 填充 + 1px 内白描边 + 元素圆角 | 2px、无填充、radius 3 | 选择框“轻”；S1 已补齐形态 | **P0**（S1 已做，颜色未做） |
| V3 | hover 框 | 同上，120ms 级淡入 | 1px、无填充 | 悬停反馈弱 | **P0**（S1 已做） |
| V4 | marker | 26px pin、编号、hover 1.08 | 18px pill | 视觉不够“pin”；S1 24px 接近，仍非 26、不可点 | **P0** |
| V5 | metadata tooltip | 元素原点、2 列、label、等宽值 | 无 | 用户看不到尺寸/颜色/字体 | **P0**（S1 已有简化版） |
| V6 | composer | 单行/可扩展、暗色、22px 圆角（task-1 证据；任务描述 26px 待确认） | 300px 表单、3 行 textarea、白底 | 信息密度低、遮挡页面、风格不统一 | **P0**（S1 已大幅接近） |
| V7 | 文字高亮 | `#128dff66` | 无 | 缺少文字选择视觉 | P1 |
| V8 | coachmark | 首次提示 | 无 | 缺少引导 | P2 |

### 5.3 动效

| # | 能力 | Codex | 插件 B0 | 差距 | 级别 |
| --- | --- | --- | --- | --- | --- |
| M1 | 统一缓动 | 150ms `cubic-bezier(.23,1,.32,1)` | 无 | 所有反馈都是瞬时切换，缺“轻”感 | **P0**（S1 已引入 MOTION） |
| M2 | marker 出现/悬停 | 出现/放大 1.08 | 无 | 无空间反馈 | **P0** |
| M3 | composer 入场 | 150ms 位移+缩放 | 无 | 弹层生硬 | **P0**（S1 160ms 近似） |
| M4 | reduced motion | 全部关闭 | 无 | S1 仅部分关闭；需补齐 | P1 |
| M5 | 光标过渡 | bubble/beam 150ms | 无光标 | S1 光标是瞬移（指针跟随可接受） | P2 |

### 5.4 可访问性

| # | 能力 | Codex | 插件 B0 | 差距 | 级别 |
| --- | --- | --- | --- | --- | --- |
| A1 | marker 语义 | `<button aria-label>` | `aria-hidden` div | 屏幕阅读器/键盘无法操作标注 | P1 |
| A2 | composer 语义 | 表单/对话框语义 | `role=dialog`，无 aria-modal/focus trap | 焦点可逃逸；Esc 后焦点不回 | P1 |
| A3 | 状态播报 | host 状态同步 | 无 aria-live | 添加/删除标注无播报 | P2 |
| A4 | 键盘可达 | marker/composer 可键盘 | 仅 Esc/输入 | 无键盘选元素 | P2 |

### 5.5 边界与工程

| # | 能力 | Codex | 插件 B0 | 差距 | 级别 |
| --- | --- | --- | --- | --- | --- |
| E1 | top layer | interaction-layer `popover=manual` | 普通 fixed div | 页面原生 `<dialog>`/全屏会盖住选择框 | P1 |
| E2 | zoom / visualViewport | zoomFactor 补偿 | 未处理 pinch zoom | 高倍缩放/触控板缩放下框位置可能偏 | P2 |
| E3 | iframe | 支持选区/frame | `elementAtPoint` 只穿 shadow，不穿 iframe | 同源 iframe 内容不可标注 | P2 |
| E4 | shadow DOM | 支持 | 部分支持（`composedPath` + shadow 下钻 + `>>>` 选择器/path） | 可用；跨 shadow 选择器非标准，但内部闭环 | — |
| E5 | CSP | 有 style root 机制 | **S1 新增 `<style>`（document.head + shadow）** | README 声称“不依赖页面 CSP 的 `<style>`”；严格 CSP 下动画/隐藏光标可能失效 | P1 |
| E6 | 滚动容器/fixed | 处理 | rect 每帧重算（scroll → rAF） | 元素标注可跟随；区域标注不跟随（已知） | P1 |
| E7 | 性能 | 缓存/批量 | `updateVisuals` 每帧写样式；S1 `updateMeta` 每次 mousemove `getComputedStyle` | 长页面/频繁 hover 可能抖 | P1 |
| E8 | 多标注重叠 | marker 偏移算法 | 同一元素多条标注 badge 重叠 | 编号互相盖住 | P1 |
| E9 | annotation 持久化 | 会话内 | 仅内存（重载清空，已知） | 不建议本轮做 | P2 |
| E10 | 协议一致性 | — | `region-select` 未消费，`annotate-remove` 无人发送 | 低风险一致性债 | P2 |

---

## 6. P0 升级方案（Lead 实现清单）

> 目标：在不改变宿主通信协议、不改源码同步、不引入依赖的前提下，把 Codex 的“轻、快、可发现”手感落到页面运行时。
> 落点基本都在 `src/runtime/inspector-runtime.js`；**先做 P0-0 颜色 token，再做 P0-1~P0-5**。每项都附“S1 已落地/仍需补齐”，避免重复劳动。

### P0-0（建议先做）标注强调色统一为 `#0069FB`

- **目标**：选择框 / hover / marquee / badge / cursor / draft / composer accent 统一为 Codex 蓝，不受 DSH 品牌色变化影响；宿主 Dock 仍用 DSH token。
- **S1 现状（23:59 已落地）**：`DEFAULT_THEME.annotationAccent = '#0069FB'`，`copyTheme`/`setTheme` 支持覆盖，新增 `annotationAccentColor()`；hover / selection / marquee / badge / region / cursor / draft / composer mark / add / flash 已改用该 token。剩余：宿主 `themePaletteForRuntime()` 未显式传值（默认兜底生效）、无 `#0069FB` 单测、浅色主题对比度未调。
- **实现（S1 已按此落地）**：
  1. `DEFAULT_THEME` 增加 `annotationAccent: '#0069FB'`；`copyTheme` 增加字段；`setTheme` 接受可选 `annotationAccent`（无则保持默认）。
  2. 新增 `annotationAccentColor()`（或直接 `theme.annotationAccent || theme.accent`），替换 `createOverlay`/`updateBadges`/`updateMeta`/`restyleOverlay` 中用于标注语义的 `theme.accent`。
  3. `alphaColor()` 已支持 `#rrggbb`，可直接用于 3%/3.5%/8% 填充。
  4. 宿主侧 `themePaletteForRuntime()` 不要覆盖 `annotationAccent`（保持运行时默认 `#0069FB`），避免 brand 污染。
- **风险**：低。唯一风险是浅色主题下 `#0069FB` 与页面内容的对比；可后续加 `isDark` 下的 `#339cff` 变体（P1）。
- **验收**：默认主题下 selection `border-color = rgb(0, 105, 251)`；`setTheme({accent:'#ff5500'})` 后 selection 仍 `#0069FB`；`setTheme({annotationAccent:'#00aa77'})` 可覆盖。

### P0-1 按住 Space 临时接管页面

- **目标**：在 annotate/edit 模式下，按住 Space → 页面恢复原生交互（点击、链接、滚动、控件），松开恢复标注；这是 Codex 最提效的“临时浏览”能力。
- **B0 现状**：无。
- **S1 现状（已落地）**：`onKeyDown`/`onKeyUp`/`onWindowBlur` + `setPassthrough`（见 §2.6）；`data-dsh-nudge-passthrough` 标记 root；`onDocumentClick/MouseDown/MouseUp` 在 passthrough 时提前返回；`setMode`/blur 复位（23:57 blur 直接复位并清 pointer/hover）。
- **仍需补齐**：
  1. **modifier/repeat/IME guard**：仅当 `!event.repeat && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey` 时触发；避免 Cmd+Space（输入法切换）等系统快捷键误触。
  2. **Escape 退出 passthrough**：在 `onKeyDown` 开头加 `if (passthrough && key === 'Escape') { preventDefault; setPassthrough(false); return }`，防止用户“卡”在接管态。
  3. **pointerleave 清理**：`onDocumentMouseOut`（relatedTarget 为空）时 `pointerSeen=false` 并隐藏 cursor/meta；否则光标停在页面边缘（S1 已知小问题）。
  4. **提示**：宿主底部状态条（`60-body.js:935-936` 的 `modeHint`）在 annotate/edit 追加「按住 Space 临时浏览页面」；无需页面内浮层，零遮挡。
  5. **不要拦截 Space 在输入框/可编辑区域的默认行为**：`isEditableTarget` 已覆盖 input/textarea/select/contenteditable/role=textbox|searchbox|combobox；再补 `[data-codex-composer]` 类选择器无意义（页面侧），但需保证 `event.target` 是页面元素（composedPath 第一项）。
- **风险**：中低。Space 是滚动页面的常用键，按住期间 `preventDefault` 会阻止页面滚动——这符合“接管”语义，但若 keyup 丢失会持续接管；已用 blur + mode switch 兜底，再加 Escape 兜底即可。不要在全局（DSH 宿主）监听。
- **验收（CDP）**：
  - `Input.dispatchKeyEvent` trusted `keyDown` Space（`code:'Space', key:' '`）→ root `data-dsh-nudge-passthrough="true"`；cursor/meta/hover 全部 `display:none`。
  - 保持 Space 时点击 demo 中一个会改文本的按钮 → 页面 handler 生效（annotate 下普通点击会被拦截，因此这是强证据）；`mouseReleased` 后 keyUp → attrs 变 `false`，hover 恢复。
  - 在页面 `<input>` 聚焦时按 Space → 不进入 passthrough。
  - popover 打开时按 Space → 不进入 passthrough，且输入空格。
  - 窗口 blur → 自动退出。

### P0-2 Codex 风格定制光标

- **目标**：annotate 模式下用 26px 定制光标替代系统箭头，让“点哪里标注”一眼可读；passthrough/popover/browse 时不显示。
- **B0 现状**：无。
- **S1 现状（已落地）**：`parts.cursor` 26×26 SVG 气泡（`fill=accent`、白描边 1.65、drop-shadow、hotspot 左下），`positionPointerCursor()` 跟随指针（`top = pointerY - 26`），`syncPointerCursor()` 控制显示；`ensureCursorStyle()` 往 `document.head` 插 `<style>{html,body,body *{cursor:none!important}}</style>`；browse/passthrough/popover/drag 隐藏。23:57 观察：显示条件已收敛为 `mode === 'annotate'`（edit 不再隐藏系统光标）。
- **仍需补齐**：
  1. **三态光标（至少两态）**：annotate 默认用 **add 十字**（Codex add 模式：20×20 路径，hotspot 中心）；hover 到已有 marker 时切 **comment 气泡**；edit 模式建议**保留系统箭头**（避免隐藏文本光标/链接指针）。实现：`parts.cursor` 内放 3 个 `<g>`/`<path>`，用 `data-mode` 切换 display；`positionPointerCursor` 按 mode 调整 hotspot。
  2. **不要把 `cursor:none` 应用到 edit 模式**（S1 已在 23:57 改为仅 annotate 显示，保留该约束）：编辑模式下点击被拦截，用户仍可能需要文本光标/链接指针。
  3. **CSP 兜底**：`ensureCursorStyle` 的 document `<style>` 在严格 `style-src` 页面可能被拒；优先用 `new CSSStyleSheet()` + `document.adoptedStyleSheets`（构造样式表不受 inline style 限制），失败再退回 `<style>`；同时用 `try/catch` + `console.warn` 记录。
  4. **pointerleave**：`mouseout`（relatedTarget 空）→ `pointerSeen=false`、`hidePart(cursor)`；`mousemove` 恢复。
  5. **光标可见性补一个 `updateVisuals` 触发点**：S1 在 mousemove 里只 `positionPointerCursor()`，首次显示依赖 `hoverEl` 变化触发 `updateVisuals`；若鼠标在空白处移动（页面没有元素）也应显示光标。建议 mousemove 里直接 `syncPointerCursor()`。
- **风险**：低-中。隐藏系统光标是“高风险感”操作；必须保证 `destroy`/browse/blur/passthrough 都恢复；不要隐藏滚动条（S1 已保留 scrollbar-width）。CSP 兜底需实测。
- **验收（CDP）**：
  - annotate + mousemove → `[data-dsh-nudge="cursor"]` display block，`left=x`、`top=y-26`；`fill`/`stroke` 符合 token；`document.querySelector('[data-dsh-nudge-cursor-style]')` 存在，`getComputedStyle(body).cursor === 'none'`。
  - browse → cursor display none，样式节点被移除，body cursor 恢复 `auto`。
  - popover 打开 / Space 按住 / 拖拽中 → cursor display none。
  - mouseout 到浏览器 chrome → cursor display none。

### P0-3 选择框 + 编号 pin marker 动效

- **目标**：选中反馈达到 Codex 的“框 + pin + 轻动效”；marker 可点回编辑，多条标注不互相盖住。
- **B0 现状**：2px 无填充 selection、18px pill badge、无动效、badge 不可点。
- **S1 现状（已落地）**：hover/selection 2px + 填充 + 内白描边 + 元素圆角；badge 24px 水滴 + 白边 + `scale(1.08)`（仅编辑中）+ 150ms transition；popover 160ms 入场；marquee 2px。
- **仍需补齐**：
  1. **marker 可点击 + hover 放大**：badge `pointer-events:auto`，加 `role="button"`、`tabindex=0`、`aria-label`（locale：编辑标注 N）；`mouseenter` → `transform: scale(1.08)`，`mouseleave` → `scale(1)`；`click`/`Enter`/`Space` → `openAnnotationEditor(id)` 并 `stopPropagation/preventDefault`。注意 root 的 `pointer-events:none` 下子元素可单独 `auto`，但要确保点击不会被页面捕获（badge 在 shadow 内，`isOverlayEvent` 会识别）。
  2. **marker 出现动效**：新增时 `scale(.6)→1` 150ms（用 `transition` + 下一帧设置，或 `@keyframes`）；`prefers-reduced-motion` 关闭。
  3. **marker 尺寸对齐 26px**（B0 18 → S1 24 → Codex 26）：`width/height 26`、font `11px/23px`、`left/top -13`；与 draft marker 一致。
  4. **重叠偏移**：同一元素/同一坐标的多条标注，按索引做 `±(i*20px)` 对角偏移（或向上堆叠），并 clamp 到视口内；区域标注与元素标注分开计算。
  5. **区域框 2px dashed**：`regionNodeFor` 的 `borderWidth` 1 → 2，填充 8% 保持；与 Codex `.region-box` 对齐。
  6. **reduced motion**：把 `hover/selection/badge/draft/popover` 的 transition/animation 全部纳入 media query；badge hover 只改 transform 不改布局。
- **风险**：低。marker 可点会增加一个“覆盖层可交互点”，注意不要吞掉页面 hover/click；badge 偏移需防负坐标（clamp 到 4px）。
- **验收（CDP/截图）**：
  - 新增标注 → `[data-dsh-nudge="badge"]` 26×26，`border-radius` 呈水滴，`display:block`，位置 = `rect.left-13/top-13`。
  - `Input.dispatchMouseEvent` 移到 badge 上 → `getComputedStyle(badge).transform` 包含 `matrix(1.08`；移出恢复。
  - 点击 badge → 打开编辑 popover 且 `textarea.value` 为原 note；页面元素没有被重新选中。
  - 同一元素两条标注 → 两个 badge 的 left/top 不同且都在视口内。
  - `Emulation.setEmulatedMedia({features:[{name:'prefers-reduced-motion',value:'reduce'}]})` → badge/draft/popover 的 `transition-duration` 为 `0s` / animation none。
  - `runtime-smoke` 的 badge 断言仍通过（现有测试查询 `[data-dsh-nudge="badge"]`）。

### P0-4 hover metadata tooltip

- **目标**：悬停元素时在元素附近显示“我现在hover的是什么、多大、什么颜色/字体”，帮助用户确认点击对象。
- **B0 现状**：无。
- **S1 现状（已落地）**：`parts.meta`（min154/max250、radius8、11px、`z7`）**锚定元素原点上方**（`rect.top - height - 8`，空间不足放下方），显示 `tag`、`W×H`、`color · fontFamily fontSize`；popover/passthrough/drag/browse 隐藏；主题切换时更新背景/文字色。23:57 观察：定位已从“跟随指针”改为“元素锚定”。
- **仍需补齐**：
  1. **信息结构对齐 Codex**：2 列 grid（label 列 56px+，value 列自适应）；行：`tag` / `size` / `color` + 色值 / `font` + `family size`；label 小写 11px muted，value 等宽右对齐；建议 minWidth 176 / maxWidth 280、radius 10、padding 8/10。
  2. **定位（S1 已落地）**：贴元素原点（`rect.left`，`rect.top - height - 8`，空间不足放下方），保证在同一元素内移动时 tooltip 不抖；元素 rect 不可用时退回指针定位。
  3. **缓存**：`hoverEl` 变化时才 `getComputedStyle`，结果存 `metaCache`（el + color/fontFamily/fontSize）；mousemove 只更新位置，避免每帧读样式。
  4. **i18n**：`locale` 增加 `metaColor`（“颜色”/“color”）、`metaFont`（“字体”/“font”）；tooltip 文本走 locale，不硬编码。
  5. **长内容**：`tag` 截断、字号值过滤空；颜色值用 `rgb()` 原样显示。
  6. **性能**：`updateMeta` 只在 hover 变化/滚动/尺寸变化时重建内容，位置用 `transform: translate3d` 减少 layout。
- **风险**：低。tooltip `pointer-events:none`，不会挡住点击；注意 `z7` 高于 popover `z6`，但 popover 打开时已隐藏，无冲突。
- **验收（CDP）**：
  - hover `#title`（demo）→ `[data-dsh-nudge="meta"]` display block；textContent 含 `h2`、`240 × 32`（或实际尺寸）、`rgb(...)`、`...px`。
  - tooltip 的位置在元素附近且完全在视口内；鼠标在元素内移动时位置稳定（不跟随指针跳动）。
  - mouseout → display none；Space/passthrough、popover、browse → display none。
  - `setTheme({isDark:true})` → tooltip 背景/文字更新（不残留旧色）。

### P0-5 composer 视觉与交互

- **目标**：把“表单式标注弹层”改成 Codex 的“单行可扩展 composer”，降低遮挡、提高输入效率。
- **B0 现状**：300px 表单（标题 + 副标题 + 3 行 textarea + 取消/添加），Cmd/Ctrl+Enter 提交，无动画。
- **S1 现状（已落地）**：340px、radius 18、padding 0、accent 圆点 + 13px 标题 + 副标题 `tag · W×H`；textarea min72/max180、radius 12、inset 背景、resize none；Enter 提交 / Shift+Enter 换行 / 空值禁用 Add；Add 为 pill；键盘提示 `↵ · ⇧↵`（符号，未 i18n）；入场动画 160ms；`aria-modal=false`；编辑态预填。
- **仍需补齐**：
  1. **圆角最终值待确认**：任务描述 26px，task-1 逆向证据 22px（评论卡片 `rounded-[22px]`）。建议先按 **22px** 实现并与 Codex 截图对比；若产品坚持 26px 再改。同时按比例调整 textarea（14px）与按钮（999）。
  2. **单行初始态**：新增标注时 textarea `height:32px`（一行），获得焦点或输入后 `64 → 120 → 180` 自动增高；编辑已有标注时初始 72px 并全选/置尾。空态 placeholder 单行可见。
  3. **尺寸**：宽 340–360px，`maxWidth: calc(100vw - 20px)`；小视口下（<420px）自动降为 `calc(100vw - 16px)`；`positionPopover` 的 gap 10、margin 10 保持。
  4. **暗色**：`panelBg` 在暗色主题下已来自 `theme.overlay`；建议 composer 表面再混入 4–6% 白、`backdrop-filter: blur(12px)`（若页面支持），亮色则混 3% 黑；不要写死 `#000`。
  5. **文案 i18n**：把硬编码 `↵ · ⇧↵` 改成 `locale.composerHint`（zh：「Enter 添加 · Shift+Enter 换行」；en：「Enter to add · Shift+Enter for a new line」）；`locale` 增加 `close`（若加 ×）、`saving` 等。
  6. **关闭 affordance**：右上角 20px × 按钮（aria-label 关闭），或点击外部关闭（当前 annotate 点击外部会选中新元素并重开 composer，行为可接受但需在文档说明）；Esc 已可用。
  7. **焦点/可访问性**：`role="dialog"` + `aria-label`；`aria-modal="false"` 合理（非模态）；打开时 focus textarea；关闭时把焦点还给 `document.body`（页面元素不可聚焦时）；不要设置 `aria-modal=true`（会误导屏幕阅读器）。
  8. **动画对齐**：150ms `cubic-bezier(.23,1,.32,1)`，从 `translateY(-4px) scale(.98)` 进入（Codex annotation editor 的入场形态），`prefers-reduced-motion` 关闭。
  9. **编辑态**：标题「编辑标注」、按钮「保存」已由 locale 处理；编辑态不要禁用空值（允许清空 note 保存），与新增态区分。
- **风险**：低。Enter 提交与 IME 组合输入需 `event.isComposing` 保护（S1 已有）；Shift+Enter 必须可靠换行；单行初始态不要导致 placeholder 截断。
- **验收（CDP）**：
  - 打开 composer → `getComputedStyle(wrap).borderRadius` 等于最终确认值（22px 或 26px）；宽度 340（或 clamp 后值）；textarea 初始高度 ≤ 34px（新增态）。
  - 输入 3 行文本 → textarea 高度增长至 ≤180px 且不出现滚动条；删除后回落。
  - Enter（无 Shift、非 IME）→ 生成 annotation、关闭 composer；Shift+Enter → 不提交、插入换行；空值 Enter → 不提交且保持焦点。
  - Esc → 关闭；编辑态预填 note、按钮文案为「保存」；点击保存 → `annotate-update`。
  - reduced motion → animation none。
  - 中英文切换 → hint 跟随 locale。

### P0 顺序与“不要做”的边界

**建议顺序**：P0-0（1 小时内）→ P0-1 Space 硬化（0.5 天）→ P0-2 光标（0.5 天）→ P0-3 marker（0.5 天）→ P0-4 tooltip（0.5 天）→ P0-5 composer（0.5 天）→ 补测试（0.5 天）。

**本轮不要做**：单 Annotate toggle、文字选择、Shift 多选、coachmark、top-layer/iframe/zoom——这些会动交互模型或增加跨 frame 复杂度，放到 P1/P2，避免 P0 失焦。

---

## 7. P1 升级清单

| 项 | 目标 | 落点/实现 | 风险 | 验收 |
| --- | --- | --- | --- | --- |
| P1-1 单 Annotate toggle | 把三模式收敛为「浏览 ⇄ 标注」主开关，编辑作为独立入口/菜单 | `30-toolbar.js:InspectorToolbar`（Segmented 处）；`00-core.js` tab.mode 保留 `edit` 兼容；快捷键加 `A`（标注）/`E`（编辑）；底部 hint 随 mode | 中：编辑入口可见性；用户习惯 | 工具栏只有 1 个主 toggle；切到 annotate 后 Dock 自动切换；edit 仍可从菜单/快捷键进入 |
| P1-2 文字选择批注 | 选中文本 → 高亮 + composer，annotation 保存 `selectedText` + text locator | runtime：`selectionchange`/`mouseup` 检测非折叠 `Range`；`Range.getClientRects()` 画多个 `[data-dsh-nudge="text-selection"]`（`#128dff66`）；composer anchor 用 range rect；`clusterAnnotation` 里加 `selectedText`；agent prompt 增加文本引用 | 中：与 region 拖拽冲突（先判断是否有文本选区再启动 marquee）；跨元素/跨 shadow 选区 | 选中一段文字后 150ms 内出现高亮框；composer 标题显示选中文本前 20 字；提交后 badge 定位在选区；prompt 含 `selectedText` |
| P1-3 Shift 多选 | Shift+click 追加/移除选择，批量 composer，prompt 分组 | runtime：`selectionEls[]` + 多 selection 框；`onDocumentClick` 读 `event.shiftKey`；`openPopover` 支持 `elements[]`；badge 编号沿用 | 中：多选与拖拽/单选的判定；错点取消 | Shift+click 两个元素 → 两个 selection 框 + composer 显示 2；提交生成一条多元素标注；普通 click 清空多选 |
| P1-4 marker 批量导航 | composer 旁显示 `‹ 1/3 ›`，可切换/定位 | `55-annotation-panel.js` + runtime `openAnnotationEditor`；或 host 侧新增浮动 batch bar | 低 | 有 2+ 标注时出现计数；点击箭头定位并高亮对应元素 |
| P1-5 可访问性 | marker button、aria-live、focus 恢复、键盘操作 | badge 改 button + tabindex；composer close 恢复焦点；`queueEvent` 后 client `aria-live` 区域播报 | 低 | axe/人工检查无“可点击非按钮”；Tab 可到 marker 并 Enter 编辑 |
| P1-6 top-layer | 覆盖层进入 top layer，避免被原生 dialog 盖住 | runtime root 设 `popover="manual"` 并 `.showPopover()`（记住元素仍 fixed）；或把 popover 单独做 top-layer 容器 | 中：shadow + popover 兼容；浏览器版本 | `<dialog open>` 场景 selection box 仍在最上层；CDP 截图验证 |
| P1-7 CSP 兜底 | 严格 CSP 页面动画/隐藏光标不失效 | `ensureCursorStyle` 与 shadow style 改用 `CSSStyleSheet`/`adoptedStyleSheets`；捕获拒绝 | 低 | 带 `Content-Security-Policy: style-src 'self'` 的 demo 页仍能隐藏光标/播放 popover 动画 |
| P1-8 性能 | hover/meta/selection 不抖动 | `metaCache`；`updateVisuals` 合并写；`radiusOf` 缓存；`getComputedStyle` 只在 hover 变化时读 | 低 | 1000 元素页面连续 hover 10s，无长任务 > 16ms（Performance 面板） |
| P1-9 marker 重叠 | 多标注不互相覆盖 | 同锚点偏移算法 + 视口 clamp | 低 | 同元素 3 条标注 badge 全部可见 |
| P1-10 文案/coachmark | 新手知道 Space/拖拽/发送 | `locale` 扩展 + 首次 annotate 显示一次 coachmark（`localStorage` 记录） | 低 | 首次进入 annotate 出现一次引导；可关闭；不再出现 |

---

## 8. P2 升级清单

1. **iframe / 跨 frame 标注**：同源 iframe 注入 runtime 或通过 `postMessage` 代理；跨域不支持。
2. **zoom / visualViewport / pinch**：按 `visualViewport.scale` 和 `devicePixelRatio` 校正坐标；区域标注同样。
3. **区域标注滚动锚定**：保存 `Document` 坐标（`x + scrollX`）或元素锚点，滚动后重算；避免“框在原地”。
4. **annotation 持久化**：按 page URL + 会话保存到 Host（`nudge/*` 新 endpoint），刷新/重载恢复；注意隐私与 workspace 授权。
5. **多选/文字标注的跨 shadow 支持**：用 `composedPath` + `ShadowRoot.getSelection` 处理。
6. **高对比/减少动画/屏幕阅读器**：`forced-colors`、`prefers-contrast`、aria-live、键盘全流程。
7. **composer 附件**：截图、元素 HTML、console 错误引用（Codex 的 comment attachment 思路）。
8. **inline text edit**：双击文本直接编辑（与现有 content panel 联动）。
9. **事件协议清理**：`region-select` 消费、`annotate-remove` 发送或删除分支；统一 `annotate-*` 生命周期。
10. **coachmark 进阶**：首次标注、首次发送分别引导。

---

## 9. 测试基线与建议

### 9.1 基线结果（只读运行，未改测试）

| 命令 | 结果 | 运行时刻/版本 | 说明 |
| --- | --- | --- | --- |
| `node test/runtime-smoke.mjs` | **187 checks, 0 failure(s)** | B0（1812 行，23:49 前） | 纯 DOM sandbox；覆盖 API、模式、描述符、style/text/attr、selection-lost、点击 popover、编辑/删除、Esc、区域拖拽、locate、locale/theme、重注入、destroy |
| `node test/client-smoke.mjs` | **client smoke ok（18 项全过）** | B0 | bundle factory、inject、locale、tab/guide/body、composer 入口/chip、browser 引导卡/菜单、context menu、shortcut |
| `node test/runtime-cdp.mjs` | **99 checks, 0 failure(s)**（9222 可用，未 SKIP） | B0 与 S1-latest（hash `7331ec64`，23:58 复跑；P0-0 于 23:59 落地后未再跑） | 真实 Chromium：demo server、CDP tab、API surface、真实鼠标选中、多级弹窗、动态重渲染 selection-lost、marquee、SPA page-info、重注入 |
| `node test/runtime-smoke.mjs`（S1-early，hash `c0db799`） | 187/187 | 23:50 快照 | 并行 P0 早期改动未破坏基线 |
| `node test/client-smoke.mjs`（S1-early） | 全过 | 同上 | 同上 |
| `node test/runtime-smoke.mjs`（S1-latest，hash `c510d444`） | **195 checks, 0 failure(s)** | 23:59 | Lead 于 23:53 在测试中加入 `Codex-style selection chrome`（3 条）与 `space passthrough`（5 条）；P0 改动未破坏原 187 条 |
| `node test/client-smoke.mjs`（S1-latest，hash `c510d444`） | 全过 | 23:59 | 同上 |
| `node test/runtime-smoke.mjs`（收尾复测，hash `fac5e934`） | **198 checks, 0 failure(s)** | 00:00 | Lead 在 23:59–00:00 继续新增 3 条断言（195 → 198）；P0 增量未破坏基线 |

> `runtime-cdp` 在 S1-latest 复跑仍 99/99，但现有 CDP 用例尚未覆盖 P0 新增的“trusted Space 按键 / 光标位置 / tooltip / marker 交互 / composer”；P0 行为的 CDP 覆盖仍待补。
> 未运行 `source-sync.test.mjs` / `host-integration.test.mjs`（本次审计范围聚焦交互与页面运行时；ACCEPTANCE 记录为 125/125、30/30）。

### 9.2 测试覆盖缺口

S1 已补 Space/选择框的基础断言（8 条），但以下仍**无断言**：

- **Space 边界**：trusted key、输入框/popover guard、blur 退出、modifier/repeat/IME、Esc 退出；
- **选择框颜色 token**：`#0069FB` 与 `setTheme` 覆盖（现有只断言 2px + 填充 0.035）；
- 定制光标（显示/隐藏/位置/三态/系统光标样式/CSP）；
- metadata tooltip（内容/元素锚定/隐藏/缓存）；
- marker 尺寸/可点/hover 放大/重叠偏移/出现动画；
- composer 单行/扩展/Enter/Shift+Enter/Esc/禁用态/圆角（22 或 26）/暗色；
- reduced motion；
- CSP 页面兜底；
- top-layer / 原生 `<dialog>` 场景。

### 9.3 建议新增用例（由 Lead 在 P0 后补，本审计不改测试）

**runtime-smoke（fake DOM 即可）**

1. `setMode('annotate')` 后派发 `mousemove` → `[data-dsh-nudge="cursor"]` 存在且 `display=block`（fake DOM 无 shadow，root 直查）。
2. 派发 Space keydown → root `data-dsh-nudge-passthrough="true"`；点击页面按钮不再 `preventDefault`（事件未被拦截）；keyup 恢复。
3. 在 `textarea` 内派发 Space → 不进入 passthrough。
4. 打开 popover → `[data-dsh-nudge="draft"]` display block；关闭 → none。
5. hover 元素 → `[data-dsh-nudge="meta"]` display block 且包含 tag/size；mouseout → none。
6. composer：`borderRadius`（内联 style）为最终确认值（22 或 26px）；textarea 初始高度；空值 Enter 不提交；有值 Enter 提交；Shift+Enter 不提交。
7. 新增标注 → badge `width/height 26px`；两条同元素标注 → left/top 不同。
8. `setTheme({annotationAccent:'#00aa77'})` → selection border-color 更新。
9. `destroy()` 后 cursor style 节点被移除、listener 数归零（现有 destroy 用例扩展）。

**runtime-cdp（真实事件）**

1. `Input.dispatchKeyEvent` trusted Space → passthrough；保持按键点击 demo 按钮 → 页面副作用发生；keyUp 恢复。
2. `Input.dispatchMouseEvent` move → cursor 位置跟随；`getComputedStyle(body).cursor === 'none'`。
3. marker hover/click → transform scale / 编辑 popover 打开。
4. `Emulation.setEmulatedMedia` reduce → 过渡为 none。
5. 带 CSP 的 demo 页：runtime 注入后无 console CSP 报错、光标隐藏仍生效（若采用兜底）。
6. 截图回归（可选）：selection/marker/composer 与 `docs/evidence` 对比。

### 9.4 CDP 验收片段（可直接给 Lead 用）

```js
// 1) 读取覆盖层
const root = document.querySelector('[data-dsh-nudge-root]')
const sr = root.shadowRoot || root
sr.querySelector('[data-dsh-nudge="selection"]').getBoundingClientRect()
root.getAttribute('data-dsh-nudge-passthrough')

// 2) trusted Space（CDP）
await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })

// 3) marker hover / click（CDP）
await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })

// 4) reduced motion
await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
```

---

## 10. 验收标准汇总（可 CDP/测试验证）

| ID | 验收项 | 判定方法 | 通过条件 |
| --- | --- | --- | --- |
| P0-A1 | Space 进入/退出接管 | CDP trusted key + `root.dataset` | keydown 后 `data-dsh-nudge-passthrough="true"`；keyup 后 `"false"` |
| P0-A2 | Space 边界 | 输入框聚焦/popover 打开/blur | 不进入接管；blur 自动退出 |
| P0-A3 | 自定义光标 | mousemove + DOM 查询 | cursor `display:block`、位置 = 指针、`fill` 为 annotation accent |
| P0-A4 | 光标抑制 | browse/popover/passthrough/drag | cursor `display:none`；browse 时系统光标样式移除 |
| P0-A5 | 选择框 | 选中元素后读取内联样式 | `border-width:2px`、`border-color:#0069FB`、背景 alpha≈0.03、内阴影存在 |
| P0-A6 | marker | 新增标注 | 26×26、水滴圆角、显示在元素左上、编号正确 |
| P0-A7 | marker 交互 | hover/click | hover `scale(1.08)`；click 打开编辑 popover |
| P0-A8 | tooltip | hover 元素 | 显示 tag/size/color/font；位置在元素附近且不出视口；移出隐藏 |
| P0-A9 | composer 几何 | 打开 | `border-radius` 为最终确认值（22 或 26px）、宽度 340 左右、暗色主题下背景为 overlay 系 |
| P0-A10 | composer 输入 | Enter/Shift+Enter/空值/Esc | 有值 Enter 提交；Shift+Enter 换行；空值不提交；Esc 关闭 |
| P0-A11 | 动效 | CDP emulate reduce | 过渡/动画关闭；正常模式下 150ms/160ms 级 |
| P0-A12 | 颜色 token | setTheme | 默认 annotation accent `#0069FB`；宿主 brand 变化不影响；可显式覆盖 |
| P0-A13 | 回归 | 三个测试命令 | runtime **198/198**（收尾）、client 全过、cdp 99/99（B0 为 187/187） |
| P0-A14 | CSP | 严格 CSP demo | 无注入报错；光标/动画仍生效（有兜底） |
| P1-A1 | 单 Annotate toggle | 工具栏快照 + 模式切换 | 只有一个主开关；edit 仍可达 |
| P1-A2 | 文本批注 | 选中文字 | 高亮出现；提交后 badge 在选区；prompt 含 selectedText |
| P1-A3 | Shift 多选 | Shift+click ×2 | 两个选择框；composer 计数为 2；提交多元素 |
| P1-A4 | marker 可访问 | Tab/Enter | 可聚焦、aria-label、Enter 打开编辑 |
| P1-A5 | top layer | `<dialog open>` 场景 | 选择框在最上层（截图/DOM 顺序） |

---

## 11. 风险与回滚

### 11.1 主要风险

| 风险 | 触发条件 | 影响 | 缓解 |
| --- | --- | --- | --- |
| Space keyup 丢失 | 用户按 Space 时切换窗口/系统卡顿 | 页面持续被“接管”，标注失效 | window blur 复位 + Esc 退出 + mode 切换复位 |
| 全局 `cursor:none` | 注入 style 失败/页面 CSP | 页面失去光标（如果 style 生效但运行时异常） | style 与 cursor 显隐同生命周期；destroy/browse 移除；CSP 兜底 |
| 从 `<style>` 注入被 CSP 拒绝 | 严格 style-src | 动画/光标隐藏不生效 | `adoptedStyleSheets` 兜底 + 失败降级（功能不阻塞） |
| marker 可点击吞掉页面点击 | 元素左上角 | 少量页面点击被拦截 | 仅 26px 区域；stopPropagation 后仍选中；可关闭 marker 可点（配置） |
| Enter 提交与 IME | 中文/日文输入 | 误提交 | `event.isComposing` 保护；Shift+Enter 换行 |
| 单行 composer 与多行需求 | 长文本用户 | 输入体验下降 | 自动增高 + 最大 180px；编辑态默认展开 |
| 三模式收敛（P1） | 用户习惯 | 找不到编辑入口 | 保留 `⌘⇧I`/编辑快捷键与菜单入口；灰度 |
| 并行修改冲突 | Lead 持续改 runtime | 文档行号/状态过期 | 以函数名 + hash 为准；P0 验收清单重验 |
| 无 git 仓库 | 项目根无 `.git`（`git status` 128） | 回滚困难 | 每个 P0 提交前备份 `inspector-runtime.js`；或初始化 git |

### 11.2 回滚

- P0 全部是**运行时表现层**改动，不涉及 Host API、源码同步、数据格式；回滚方式：
  1. 回退 `src/runtime/inspector-runtime.js`（+ 如新增 locale 键则回退 locale / client）；
  2. 重新注入（导航刷新或重开检查器 Tab）即可；
  3. 已有标注数据只在内存，回滚不涉及迁移。
- 建议 Lead 在 P0 开始前/每个子项完成后保留 `src/runtime/inspector-runtime.js` 备份（项目当前没有 git 元数据）。

---

## 12. 附录

### A. 审计文件哈希

```
runtime (B0)              n/a（已被并行覆盖；1812 行）
runtime (S1-early)        c0db79980f612da0d2854f949a3174aff4eb668573665a2e20bc1a0a884a8f9d
runtime (S1-latest)       c510d444a1d3e27501c4416f6f09d58a7222ccf6a0780f5994506ae5900dbf8d
client/00-core.js         27a8c13c9ef1899c9e8e51d79b366b32a835a59cdbca6bfacebd80c02953d056
client/10-carrier.js      552da586f62b5c45ead4ccf4da44d11aea401504b0ac34877d9440b30c156658
client/20-primitives.js   2b29809426a9d5123659027664faaeaecfdd26b38746615898fe995dc088c1c2
client/30-toolbar.js      464c28eeae08abf51b445842fb8e2dbf75f0cb28761811ac5ac9d4364c696c41
client/55-annotation...    b3a15f9864f79df47efbc7aefd9b92f4e0e716fa0d4352d6f0c96078327ea0fa
client/60-body.js         fda4b635c65d739b9c187af0843cf8efd954bdffcd7ecba89017b1eee550f31e
client/65-browser...      4511dd6c8e3a9f546d92e48e07138a21380deefcff966abd2c63b956e334be0d
client/70-register.js     34111512201876669679516a472df74af336eb95d8f01a7e024bf55c9e4a14de
locale/zh.json            f193da0a9ac465c4c8176741c0499571fd28dd7b1b5ba81c69a326bf015c1e93
locale/en.json            096cd5c3f63e3d0a303d92252ddb9d5c78b1ba67874b307faace50012b72ecb8
test/runtime-smoke.mjs    2eaf634ef1120aa968ae6dd50a3ad8190b387ebe816cfbe5d19f407d9570375a
test/client-smoke.mjs     2d6aa3f6e4955958ad2bfe27cc3a4a4aeff02d7267901514a7ba2908ecb833cf
test/runtime-cdp.mjs      18961e8a70f000d2aa20edd9990fddca8ff415904062e2ace62f613652b2f6e8
```

### B. S1 并行实现进度对照（截至 hash `c510d444`，23:59）

| P0 子项 | S1 状态 | 已落地 | 仍缺 |
| --- | --- | --- | --- |
| P0-0 `#0069FB` token | ✅ 已落地（23:59） | `DEFAULT_THEME.annotationAccent='#0069FB'` + `copyTheme`/`setTheme` + `annotationAccentColor()`；hover/selection/marquee/badge/region/cursor/draft/composer 全部改用 | 无 `#0069FB` 单测；浅色主题对比度；宿主 palette 可选显式传值 |
| P0-1 Space 接管 | 🟡 基本可用 | keydown/keyup、passthrough 守卫、mode 复位、blur 直接复位（23:57） | modifier/repeat/IME guard、Esc 退出、提示文案、pointerleave 清理 |
| P0-2 定制光标 | 🟡 单态 | 26px 气泡、跟随、系统光标隐藏、仅 annotate 显示（23:57） | 三态（add/comment/text）、CSP 兜底、pointerleave、空白处首次显示 |
| P0-3 选择框/marker | 🟡 大部分 | 2px+填充+内描边+元素圆角、24px 水滴、150ms、编辑中 1.08 | marker 26px、可点/hover、出现动画、重叠偏移、region 2px、reduced motion 全覆盖 |
| P0-4 tooltip | 🟡 简化版 | 元素原点锚定（23:57）、tag/size/color/font、主题热更新 | label 列、等宽值、缓存、i18n、尺寸微调 |
| P0-5 composer | 🟡 接近 | 340px、18px、Enter/Shift+Enter、自动增高、禁用态、`↵ · ⇧↵` 提示、入场动画 | 圆角最终值（22 vs 26，待确认）、单行初始态、hint i18n、关闭按钮、暗色表面、reduced motion 对齐 |

> 该表是“观察快照”，不是对 Lead 实现的评价；若某项已在 23:57 后继续推进，以代码与 P0 验收清单为准。S1-latest 的 `runtime-smoke` 已由 Lead 增加到 195 checks（selection chrome 3 条 + space passthrough 5 条，23:53），收尾时进一步到 198 checks，仍然全过。

### C. Codex 证据行号索引

- `/tmp/codex-extract/browser-page-preload.pretty.js`
  - 强调色/缓动：`20239-20240`
  - hover-box / text-selection / region / marker / cursor CSS：`20276-20307`
  - cursor hotspot/路径/三态：`20247-20272`、`20284-20292`
  - metadata tooltip CSS：`14368-14423`
  - metadata tooltip JSX：`20440-20520`
  - marker 尺寸/变量：`25284-25293`；`E.QH=26`（`14697-14700` 附近）
  - Space 临时接管：`23345-23360`、`23371`
  - Shift 多选：`23600-23690`、`23990-24020`
  - text selection 高亮：`20279`、`25382`
  - interaction-layer `popover=manual`：`20520` 附近
- `/tmp/codex-extract/webview/assets/async/*`：coachmark `--color-background-coachmark` + notch（36×14 / 14×36）；评论批量条 radius 12px / 控件 28px（与 composer 26px 属不同表面）。
- 插件截图：`docs/evidence/02-element-selection.png`、`05-annotate-popover.png`、`06-annotation-list-and-agent.png`、`12-browser-chooser.png`。

### D. 术语

- **B0**：本轮升级前的插件交付态（runtime 1812 行）。
- **S1 / S1-early**：Lead 并行实现期间的冻结快照；用于说明“已落地/仍缺”，不是验收结论。
- **observed / inferred / unknown**：分别表示代码/资源直接可见、由数值推断、以及本机证据无法确认。
- **passthrough**：S1 中 Space 临时接管状态（页面原生交互恢复）。

---

*本文只读审计产出；未修改源码、测试与 locale。P0 实现与回归由 Lead 执行，建议按 §10 验收表逐项勾验。*
