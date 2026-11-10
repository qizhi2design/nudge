#!/usr/bin/env node
/**
 * market-index.mjs — 生成 DSH 插件市场索引 `market/index.json`（format 1）。
 *
 * 这个索引是 DSH「发现 → 添加索引 URL」里填的那个地址，发布后由
 *   https://raw.githubusercontent.com/qizhi2design/nudge/main/market/index.json
 * 提供。它和 npm 上的包是两份数据：npm 负责“安装哪个包”，索引负责“市场怎么展示、
 * 以及自动更新该去查哪个版本”。
 *
 * 用法：
 *   node scripts/market-index.mjs                     # 用当前时间作为发布时间
 *   node scripts/market-index.mjs --publish-timestamp=1730000000
 *   node scripts/market-index.mjs --dry-run           # 只校验并打印，不写文件
 *
 * 规则（DSH plugin market index format 1，校验很严格）：
 *   - 顶层 format:1、title（localized 且必须含 en），plugins 非空数组；
 *   - localized text 的键必须是小写语言 id 且必须含 en；
 *   - version 必须是精确 SemVer，publishTimestamp 是整数 Unix 秒 [0, 1e11)；
 *   - source 为 {type:"npm"} 或 {type:"git",url,commit,path?}；
 *   - engines.dsh 必须是 SemVer range；
 *   - repository.directory 不能出现 "." / ".." 段（所以本文件故意不写 directory）。
 *
 * 版本历史：同一个版本只保留一条，新发布的版本放在 versions 最前面，
 * 旧版本原样保留，这样已安装旧版本的用户仍然能通过市场/自动更新看到新版本。
 *
 * 脚本只依赖 Node 内置模块，保持 ESM，本地 node 24 / npm 11 可直接跑。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_PATH = join(ROOT, 'package.json')
const INDEX_PATH = join(ROOT, 'market', 'index.json')

/** 公开仓库地址：插件代码就放在仓库根目录。 */
const REPO_URL = 'https://github.com/qizhi2design/nudge'
const ICON_URL = 'https://raw.githubusercontent.com/qizhi2design/nudge/main/icon.svg'
/** 这个包要求的最低 DSH 版本（SemVer range）。 */
const DSH_ENGINE_RANGE = '>=0.2.0'
/** publishTimestamp 上限：1e11 秒 UTC ≈ 5138 年，超过一定不是合法 Unix 秒。 */
const MAX_PUBLISH_TIMESTAMP = 1e11

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const LANGUAGE_ID_RE = /^[a-z][a-z0-9-]*$/

/** 市场里的文案，面向设计师和产品经理，中英双语。 */
const TITLE = { en: 'Nudge', zh: '轻推' }
const DESCRIPTION = {
  en: 'Point at anything on a web page, leave a note for your AI assistant, or fine-tune its styles and text until it looks right.',
  zh: '在网页上点选任意元素，给 AI 助教留一条批注，或者直接把它调成你想要的样子。',
}
const KEYWORDS = ['ui-design', 'product-design', 'annotation', 'browser', 'design-review']

/* ------------------------------------------------------------------ 参数 */

function printHelp() {
  process.stdout.write(
    [
      '用法: node scripts/market-index.mjs [--publish-timestamp=<unix 秒>] [--dry-run]',
      '',
      '  --publish-timestamp=<秒>  指定发布时间（整数 Unix 秒，默认取当前时间）',
      '  --dry-run                 只生成并校验，不写 market/index.json',
      '  --help                    显示本帮助',
      '',
    ].join('\n'),
  )
}

/** 解析命令行参数；任何未知参数都直接报错，避免 CI 里静默传错。 */
function parseArgs(argv) {
  const options = { publishTimestamp: null, dryRun: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--publish-timestamp' || arg.startsWith('--publish-timestamp=')) {
      const raw = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[(index += 1)]
      options.publishTimestamp = parseTimestamp(raw)
    } else {
      throw new Error('未知参数: ' + arg + '（用 --help 查看用法）')
    }
  }
  return options
}

function parseTimestamp(raw) {
  const value = Number(raw)
  if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(value)) {
    throw new Error('--publish-timestamp 必须是整数 Unix 秒，收到: ' + JSON.stringify(raw))
  }
  if (value < 0 || value >= MAX_PUBLISH_TIMESTAMP) {
    throw new Error('--publish-timestamp 必须在 [0, 1e11) 内，收到: ' + value)
  }
  return value
}

/* ------------------------------------------------------------- 索引构建 */

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 读取已有的索引，只接受与我们这个插件匹配的 format 1 索引。 */
function readExistingIndex() {
  if (!existsSync(INDEX_PATH)) return null
  let index
  try {
    index = readJson(INDEX_PATH)
  } catch (error) {
    throw new Error('已有 market/index.json 不是合法 JSON: ' + error.message)
  }
  if (!index || index.format !== 1 || !Array.isArray(index.plugins)) return null
  return index
}

function normalizeVersionEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (!SEMVER_RE.test(String(entry.version || ''))) return null
  const timestamp = Number(entry.publishTimestamp)
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp >= MAX_PUBLISH_TIMESTAMP) {
    return null
  }
  const source =
    entry.source && entry.source.type === 'git'
      ? entry.source
      : { type: 'npm' }
  return {
    version: entry.version,
    publishTimestamp: timestamp,
    source,
    engines: { dsh: DSH_ENGINE_RANGE },
  }
}

/**
 * 组装一整份索引。
 *
 * @param {{version: string}} pkg       package.json 内容
 * @param {number} publishTimestamp     本次发布时间（Unix 秒）
 * @param {object|null} existingIndex   已有索引（用于保留历史版本）
 * @param {boolean} timestampProvided   是否由命令行显式给了时间戳
 */
function buildIndex(pkg, publishTimestamp, existingIndex, timestampProvided) {
  const previousVersions = []
  const previous = existingIndex && existingIndex.plugins ? existingIndex.plugins[0] : null
  if (previous && previous.name === pkg.name && Array.isArray(previous.versions)) {
    for (const entry of previous.versions) {
      const normalized = normalizeVersionEntry(entry)
      if (normalized && normalized.version !== pkg.version) previousVersions.push(normalized)
    }
  }

  const current = normalizeVersionEntry({
    version: pkg.version,
    publishTimestamp,
    source: { type: 'npm' },
  })
  if (!current) throw new Error('package.json 的 version 不是合法 SemVer: ' + pkg.version)

  // 重新发布同一个版本时：给了新时间戳就更新，否则沿用旧时间戳，避免索引抖动。
  if (!timestampProvided && previous && Array.isArray(previous.versions)) {
    const same = previous.versions.find((entry) => entry && entry.version === pkg.version)
    const normalizedSame = normalizeVersionEntry(same)
    if (normalizedSame) current.publishTimestamp = normalizedSame.publishTimestamp
  }

  return {
    format: 1,
    title: TITLE,
    description: DESCRIPTION,
    metadata: {
      categories: {
        design: { title: { en: 'Design', zh: '设计' } },
        productivity: { title: { en: 'Productivity', zh: '效率' } },
      },
      labels: {
        design: { title: { en: 'Design', zh: '设计' } },
        annotation: { title: { en: 'Annotation', zh: '批注' } },
      },
    },
    plugins: [
      {
        name: pkg.name,
        title: TITLE,
        description: DESCRIPTION,
        icon: ICON_URL,
        author: 'Purity3',
        homepage: REPO_URL,
        // 注意：这里不写 directory。"." 会被 packagePath 校验拒绝，
        // 省略 directory 表示插件就在仓库根目录。
        repository: { url: REPO_URL },
        metadata: {
          category: 'design',
          keywords: KEYWORDS,
          labels: ['design', 'annotation'],
        },
        versions: [current, ...previousVersions],
      },
    ],
  }
}

/* --------------------------------------------------------------- 校验 */

function isLocalized(value) {
  if (typeof value === 'string') return value.trim().length > 0
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  if (!keys.includes('en')) return false
  return keys.every(
    (key) => LANGUAGE_ID_RE.test(key) && typeof value[key] === 'string' && value[key].trim().length > 0,
  )
}

function isSemverRange(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  // 够用的 range 形状校验：允许 ^ ~ >= <= > < = x * || - 与空格，且至少含一个数字。
  if (!/\d/.test(value)) return false
  return /^[\s0-9A-Za-z.*xX^~<>=|+_-]+$/.test(value)
}

function isSafeRelativeDirectory(value) {
  if (typeof value !== 'string' || value === '') return false
  if (value.startsWith('/') || value.startsWith('\\')) return false
  return value.split(/[\\/]/).every((segment) => segment !== '.' && segment !== '..' && segment !== '')
}

function isIconValue(value) {
  if (typeof value !== 'string') return false
  if (/^https:\/\/\S+$/.test(value)) return true
  if (/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(value)) {
    return Buffer.byteLength(value, 'utf8') <= 32 * 1024
  }
  return false
}

/**
 * 按 format 1 规则逐条校验，返回错误列表。空数组表示通过。
 * 这是发布前的最后一道闸门：索引是 raw.githubusercontent 上的静态文件，
 * 一旦写坏，市场会整体加载失败，所以宁可在本地先失败。
 */
function validateIndex(index) {
  const errors = []
  const fail = (message) => errors.push(message)

  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return ['索引必须是对象']
  }
  if (index.format !== 1) fail('format 必须是数字 1')
  if (!isLocalized(index.title)) fail('title 必须是 localized text 且包含 en')
  if (index.description !== undefined && !isLocalized(index.description)) {
    fail('description 必须是 localized text 且包含 en')
  }

  const metadata = index.metadata
  const categories = metadata && metadata.categories
  const labels = metadata && metadata.labels
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null)) {
    fail('metadata 必须是对象')
  }
  if (categories !== undefined) {
    if (typeof categories !== 'object' || categories === null || Array.isArray(categories)) {
      fail('metadata.categories 必须是对象')
    } else {
      for (const [id, category] of Object.entries(categories)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail('metadata.categories 的 id 不合法: ' + id)
        if (!category || !isLocalized(category.title)) {
          fail('metadata.categories.' + id + '.title 必须是 localized text')
        }
      }
    }
  }
  if (labels !== undefined) {
    if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) {
      fail('metadata.labels 必须是对象')
    } else {
      for (const [id, label] of Object.entries(labels)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail('metadata.labels 的 id 不合法: ' + id)
        if (!label || !isLocalized(label.title)) {
          fail('metadata.labels.' + id + '.title 必须是 localized text')
        }
      }
    }
  }
  if (metadata && metadata.sortKeys !== undefined) {
    const sortKeys = metadata.sortKeys
    if (typeof sortKeys !== 'object' || sortKeys === null || Array.isArray(sortKeys)) {
      fail('metadata.sortKeys 必须是对象')
    } else {
      for (const [id, sortKey] of Object.entries(sortKeys)) {
        if (!sortKey || !isLocalized(sortKey.title)) {
          fail('metadata.sortKeys.' + id + '.title 必须是 localized text')
        }
        if (sortKey.order !== 'asc' && sortKey.order !== 'desc') {
          fail('metadata.sortKeys.' + id + '.order 必须是 "asc" 或 "desc"')
        }
      }
    }
  }

  if (!Array.isArray(index.plugins) || index.plugins.length === 0) {
    fail('plugins 必须是非空数组')
    return errors
  }

  for (const plugin of index.plugins) {
    if (!plugin || typeof plugin !== 'object') {
      fail('plugins[] 必须是对象')
      continue
    }
    if (typeof plugin.name !== 'string' || !NPM_NAME_RE.test(plugin.name)) {
      fail('plugins[].name 不是合法 npm 包名: ' + String(plugin.name))
    }
    if (plugin.title !== undefined && !isLocalized(plugin.title)) {
      fail(plugin.name + ': title 必须是 localized text')
    }
    if (plugin.description !== undefined && !isLocalized(plugin.description)) {
      fail(plugin.name + ': description 必须是 localized text')
    }
    if (plugin.icon !== undefined && !isIconValue(plugin.icon)) {
      fail(plugin.name + ': icon 必须是 https URL 或 data:image（≤32KiB）')
    }
    if (plugin.repository !== undefined) {
      const repository = plugin.repository
      if (!repository || typeof repository !== 'object') {
        fail(plugin.name + ': repository 必须是对象')
      } else {
        if (typeof repository.url !== 'string' || repository.url === '') {
          fail(plugin.name + ': repository.url 必须是非空字符串')
        }
        if (repository.directory !== undefined && !isSafeRelativeDirectory(repository.directory)) {
          fail(plugin.name + ': repository.directory 必须是合法相对目录，不能含 "." / ".." 段')
        }
      }
    }

    const pluginMetadata = plugin.metadata
    if (pluginMetadata !== undefined) {
      if (typeof pluginMetadata !== 'object' || pluginMetadata === null) {
        fail(plugin.name + ': metadata 必须是对象')
      } else {
        if (pluginMetadata.category !== undefined) {
          if (!categories || !Object.prototype.hasOwnProperty.call(categories, pluginMetadata.category)) {
            fail(plugin.name + ': metadata.category 必须是已声明的 category id')
          }
        }
        if (pluginMetadata.keywords !== undefined) {
          if (
            !Array.isArray(pluginMetadata.keywords) ||
            pluginMetadata.keywords.some((keyword) => typeof keyword !== 'string' || keyword === '')
          ) {
            fail(plugin.name + ': metadata.keywords 必须是字符串数组')
          }
        }
        if (pluginMetadata.labels !== undefined) {
          if (
            !Array.isArray(pluginMetadata.labels) ||
            pluginMetadata.labels.some((label) => typeof label !== 'string')
          ) {
            fail(plugin.name + ': metadata.labels 必须是字符串数组')
          } else {
            if (new Set(pluginMetadata.labels).size !== pluginMetadata.labels.length) {
              fail(plugin.name + ': metadata.labels 不能重复')
            }
            for (const label of pluginMetadata.labels) {
              if (!labels || !Object.prototype.hasOwnProperty.call(labels, label)) {
                fail(plugin.name + ': metadata.labels 引用了未声明的 label: ' + label)
              }
            }
          }
        }
      }
    }

    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
      fail(plugin.name + ': versions 必须是非空数组')
      continue
    }
    const seen = new Set()
    for (const version of plugin.versions) {
      if (!version || typeof version !== 'object') {
        fail(plugin.name + ': versions[] 必须是对象')
        continue
      }
      if (typeof version.version !== 'string' || !SEMVER_RE.test(version.version)) {
        fail(plugin.name + ': version 必须是精确 SemVer，收到 ' + String(version.version))
        continue
      }
      if (seen.has(version.version)) fail(plugin.name + ': version 重复: ' + version.version)
      seen.add(version.version)
      if (
        !Number.isInteger(version.publishTimestamp) ||
        version.publishTimestamp < 0 ||
        version.publishTimestamp >= MAX_PUBLISH_TIMESTAMP
      ) {
        fail(plugin.name + '@' + version.version + ': publishTimestamp 必须是 [0, 1e11) 的整数')
      }
      const source = version.source
      if (!source || typeof source !== 'object') {
        fail(plugin.name + '@' + version.version + ': source 缺失')
      } else if (source.type === 'npm') {
        // npm 源不需要额外字段。
      } else if (source.type === 'git') {
        if (typeof source.url !== 'string' || source.url === '') {
          fail(plugin.name + '@' + version.version + ': git source 需要 url')
        }
        if (typeof source.commit !== 'string' || source.commit === '') {
          fail(plugin.name + '@' + version.version + ': git source 需要 commit')
        }
        if (source.path !== undefined && !isSafeRelativeDirectory(source.path)) {
          fail(plugin.name + '@' + version.version + ': git source path 必须是合法相对路径')
        }
      } else {
        fail(plugin.name + '@' + version.version + ': source.type 必须是 npm 或 git')
      }
      if (!version.engines || !isSemverRange(version.engines.dsh)) {
        fail(plugin.name + '@' + version.version + ': engines.dsh 必须是 SemVer range')
      }
    }
  }

  return errors
}

/* ----------------------------------------------------------------- 主流程 */

function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    printHelp()
    return
  }

  const pkg = readJson(PACKAGE_PATH)
  const publishTimestamp = options.publishTimestamp ?? Math.floor(Date.now() / 1000)
  const existingIndex = readExistingIndex()
  const index = buildIndex(pkg, publishTimestamp, existingIndex, options.publishTimestamp !== null)

  const errors = validateIndex(index)
  if (errors.length > 0) {
    process.stderr.write('market/index.json 校验失败:\n')
    for (const error of errors) process.stderr.write('  - ' + error + '\n')
    process.exitCode = 1
    return
  }

  const json = JSON.stringify(index, null, 2) + '\n'
  const bytes = Buffer.byteLength(json, 'utf8')
  const versions = index.plugins[0].versions

  if (options.dryRun) {
    process.stdout.write(json)
    process.stdout.write(
      '\n[dry-run] 未写入；版本 ' + pkg.version + '、发布时间 ' + publishTimestamp + '、共 ' +
        versions.length + ' 个版本、' + bytes + ' 字节\n',
    )
    return
  }

  mkdirSync(dirname(INDEX_PATH), { recursive: true })
  writeFileSync(INDEX_PATH, json, 'utf8')
  process.stdout.write(
    '已写入 ' + relative(process.cwd(), INDEX_PATH) + '\n' +
      '  插件: ' + index.plugins[0].name + '\n' +
      '  版本: ' + pkg.version + '（publishTimestamp=' + publishTimestamp + '）\n' +
      '  版本数: ' + versions.length + '（' + versions.map((entry) => entry.version).join(', ') + '）\n' +
      '  大小: ' + bytes + ' 字节\n',
  )
}

try {
  main(process.argv.slice(2))
} catch (error) {
  process.stderr.write('market-index 失败: ' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
