# 发布指南（RELEASING）

`@huangqz/dsh.nudge` 一次“发布”其实包含三件事，缺一不可：

| 东西 | 位置 | 作用 |
| --- | --- | --- |
| npm 包 | https://www.npmjs.com/package/@huangqz/dsh.nudge | 用户实际安装的代码 |
| 市场索引 | 仓库里的 `market/index.json`（发布后可通过 raw URL 访问） | 市场里怎么展示、自动更新去查哪个版本 |
| GitHub Release | https://github.com/qizhi2design/nudge/releases | 版本说明；也是自动发布流水线的触发器 |

市场索引的公开地址（用户加索引时填这个）：

```
https://raw.githubusercontent.com/qizhi2design/nudge/main/market/index.json
```

> 仓库根目录就是插件包根目录（`package.json` 在根上），下面所有命令都假设当前目录是仓库根目录。

---

## 0. 一次性准备

1. **npm 账号**：能发布 `@huangqz/dsh.nudge`（发布前确认 `npm view @huangqz/dsh.nudge version` 返回 404，说明名字没被占）。
2. **GitHub 仓库**：public 的 `qizhi2design/nudge`。
3. **NPM_TOKEN（自动发布用）**：
   1. 登录 npmjs.com → 右上头像 → **Access Tokens** → **Generate New Token**；
   2. 选 **Classic Token** 的 **Automation**（最省事，不受 2FA 交互影响），或 **Granular Token**：Packages and scopes 选 *Read and write*，Packages 选 `@huangqz/dsh.nudge`，并允许 publish；
   3. 复制 token（只显示一次）；
   4. 打开 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**；
   5. Name 填 `NPM_TOKEN`，Secret 粘贴 token，保存。
4. 本地 `npm login`（手动发布时用得到）。

---

## 1. 本地手动发布（推荐第一次走一遍）

```bash
# 1) 确认当前分支干净，且和远端一致
git switch main
git pull
git status --short   # 应该没有输出

# 2) 改版本号（同时更新 package-lock 里的版本，避免 lock 与 package.json 不一致）
npm version patch --no-git-tag-version   # 1.0.0 → 1.0.1；也可用 minor / major / 明确版本号

# 3) 跑构建和测试（构建产物 lib/ 会进 npm 包，必须是最新的）
npm run build
npm test

# 4) 确认要发布的文件清单（不会真的打包上传）
npm pack --dry-run

# 5) 更新市场索引（把新版本放在 versions 最前面，历史版本自动保留）
node scripts/market-index.mjs --publish-timestamp="$(date +%s)"

# 6) 提交 + 打 tag + 推送
git add package.json package-lock.json market/index.json
git commit -m "chore(release): v1.0.1"
git tag v1.0.1
git push origin main --tags

# 7) 发布到 npm（public 包）
npm publish --access public

# 8) 在 GitHub 上创建 Release（可选，但建议，用于版本说明 + 触发自动流水线）
gh release create v1.0.1 --title "v1.0.1" --notes "发布说明..."
```

校验发布结果：

```bash
npm view @huangqz/dsh.nudge version          # 应输出刚发布的版本
curl -s https://raw.githubusercontent.com/qizhi2design/nudge/main/market/index.json | head
```

> `--publish-timestamp` 是整数 Unix 秒，必须满足 `0 ≤ ts < 1e11`；不传则用当前时间。

---

## 2. GitHub Actions 自动发布

工作流：`.github/workflows/release.yml`

- **触发**：GitHub 上 **发布 Release**（`release: published`），或手动 **Run workflow**（可勾选 `skip_publish` 只更新索引）。
- **步骤**：checkout `main` → Node 24 → `npm ci` → `npm run build` → `npm test` → 校验 Release tag 与 `package.json` 版本一致 → `npm publish --access public`（用 `secrets.NPM_TOKEN`）→ 重新生成 `market/index.json` → 提交并推回 `main`。
- **重复运行安全**：如果 npm 上已存在该版本，会跳过 publish，只更新索引。
- **权限**：`contents: write`（为了把索引提交回 main）。

所以自动发布的完整操作只有：

```bash
# 本机：改版本 → 构建测试 → 更新索引 → 提交
npm version minor --no-git-tag-version
npm run build && npm test
node scripts/market-index.mjs --publish-timestamp="$(date +%s)"
git add package.json package-lock.json market/index.json
git commit -m "chore(release): v1.1.0"
git push origin main

# GitHub：Releases → Draft a new release → tag 填 v1.1.0 → Publish
```

发布后流水线会自己 `npm publish` 并把索引提交回 main。

CI（`.github/workflows/ci.yml`）只在 PR / push 到 main 时跑 `npm ci` + `npm run build` + `npm test`，不发布。

---

## 3. 市场索引规则（改脚本前必读）

`market/index.json` 必须满足 DSH plugin market index **format 1** 的严格校验，否则市场整体加载失败。关键点：

- 顶层 `format: 1`（数字）、`title`（localized，必须含 `en`）、`plugins` 非空数组。
- localized text：字符串，或对象（键必须是小写语言 id 且必须含 `en`）。
- 每个版本：`version` 是**精确 SemVer**（不允许 `^1.0.0`）、`publishTimestamp` 是整数 Unix 秒、`source` 是 `{type:"npm"}` 或 `{type:"git",...}`、`engines.dsh` 是 SemVer range。
- `repository.directory` 不能出现 `.` / `..` 段 —— 所以索引里**故意不写** `directory`（插件就在仓库根目录）。
- `icon` 必须是 https URL（或 ≤32KiB 的 data:image）。
- `metadata.category` / `metadata.labels` 只能引用 `metadata.categories` / `metadata.labels` 里声明过的 id；labels 不能重复。

脚本 `scripts/market-index.mjs` 在写文件前会按上面规则自检，自检不过就以非 0 退出，不会写出坏索引。常用命令：

```bash
node scripts/market-index.mjs --dry-run                         # 只校验并打印
node scripts/market-index.mjs --publish-timestamp=1730000000    # 指定发布时间
node scripts/market-index.mjs                                   # 用当前时间
```

版本历史规则：同一个版本只保留一条；新版本永远在 `versions[0]`；旧版本原样保留，所以装了旧版本的用户仍能通过自动更新拿到新版本。重复发布同一版本时，如果没显式给 `--publish-timestamp`，会沿用旧时间戳，避免索引抖动。

---

## 4. 版本号语义（SemVer）

- **patch**（1.0.x）：修 bug、改文案、不改变已有配置和行为的调整。
- **minor**（1.x.0）：新增功能（新面板、新工具、新设置项），保持向后兼容。
- **major**（x.0.0）：破坏性变更（改配置字段、改 remote 接口、用户需要手动迁移）。

插件通过 `engines.dsh` 声明最低 DSH 版本；如果新版本依赖了更新的 DSH API，记得同时更新 `scripts/market-index.mjs` 里的 `DSH_ENGINE_RANGE`。

---

## 5. 发布检查清单

- [ ] `package.json` 版本已 bump，`package-lock.json` 版本一致（`npm version` 会一起改）
- [ ] `npm run build` 通过，`lib/` 里是本次代码构建出来的产物
- [ ] `npm test` 全绿
- [ ] `npm pack --dry-run` 文件清单正确（`lib/`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`README.md`、`docs/`）
- [ ] `node scripts/market-index.mjs` 成功，`market/index.json` 里 `versions[0].version` 与本次版本一致
- [ ] `git tag` 与 `package.json` 版本对应（`v1.2.3`），Release 以此 tag 创建
- [ ] GitHub Secrets 里有 `NPM_TOKEN`

---

## 6. 常见问题

**npm publish 报 401 / EOTP**：本地 token 或 `NPM_TOKEN` 失效；Automation token 不会触发 OTP，Granular token 需要带 publish 权限并放行 `@huangqz/dsh.nudge`。

**npm publish 报 403 / You do not have permission to publish "@huangqz/dsh.nudge"**：包名被占用或 token 权限不足；先用 `npm view @huangqz/dsh.nudge version` 确认。

**npm ci 报 lock 文件不同步**：`package.json` 依赖改了但没更新 `package-lock.json`；在本地执行 `npm install --package-lock-only` 后提交。

**市场里看不到新版本**：raw.githubusercontent 有 CDN 缓存（一般几分钟）；确认 release 流水线里 “Commit & push market/index.json” 那步成功、main 上的 `market/index.json` 已包含新版本。

**用户没收到自动更新**：自动更新只对 **从 npm registry 安装** 的包生效；`link` 方式安装的本地开发版不会自动更新，状态显示为不可更新是预期行为。

**索引校验失败**：直接跑 `node scripts/market-index.mjs --dry-run` 看报错；不要手改 `market/index.json` 里脚本不认识的字段。
