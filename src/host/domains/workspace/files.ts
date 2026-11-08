// @ts-nocheck
/**
 * dsh.nudge — host workspace domain: bounded HTML file scan.
 *
 * Contract: docs/workspace-versions.md §3.1.
 *
 * Scans `sourceRoot` recursively for HTML files while skipping dot entries and
 * the usual generated directories. The walk is capped by `maxScanFiles`
 * (default 400) and by a depth of 10; `truncated` reports whether the budget
 * stopped the scan before it was exhaustive.
 *
 * Returns sourceRoot-relative POSIX paths; the domain later attaches the git
 * change label. No top-level side effects.
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { isIgnoredName } from './paths.js'

const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const DEFAULT_MAX_SCAN_FILES = 400
const MAX_DEPTH = 10

function isHtmlName(name) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return HTML_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

async function statFile(absolutePath) {
  try {
    return await stat(absolutePath)
  } catch {
    return undefined
  }
}

/**
 * Walk one bounded directory tree and collect HTML files.
 * @param {{sourceRoot: string, maxScanFiles?: number}} deps
 * @returns {Promise<{files: Array<{path: string, name: string, dir: string, size: number, mtime: number, change: null}>, truncated: boolean}>}
 */
export async function scanHtmlFiles({ sourceRoot, maxScanFiles }) {
  const budget =
    typeof maxScanFiles === 'number' && Number.isFinite(maxScanFiles) && maxScanFiles > 0
      ? Math.floor(maxScanFiles)
      : DEFAULT_MAX_SCAN_FILES
  const files = []
  let truncated = false

  async function walk(absoluteDir, relativeDir, depth) {
    if (truncated) return
    let entries
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (truncated) return
      if (isIgnoredName(entry.name)) continue
      const relativePath = relativeDir ? relativeDir + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) continue
        await walk(join(absoluteDir, entry.name), relativePath, depth + 1)
        continue
      }
      if (!entry.isFile() || !isHtmlName(entry.name)) continue
      if (files.length >= budget) {
        truncated = true
        return
      }
      const info = await statFile(join(absoluteDir, entry.name))
      if (info === undefined) continue
      files.push({
        path: relativePath,
        name: entry.name,
        dir: relativeDir,
        size: info.size,
        mtime: Math.floor(info.mtimeMs),
        change: null,
      })
    }
  }

  await walk(sourceRoot, '', 0)
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, truncated }
}
