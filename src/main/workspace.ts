// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { detectFormat } from './file-formats.js'
import { getPinnedFiles, getRecentFiles, getSettings } from './settings.js'
import { parseFrontmatter } from './frontmatter.js'
import { documentText, extractCitations, extractWikilinks } from '../shared/document-utils.js'
import { formatBibliographyEntry, parseBibTeX } from '../shared/bibliography.js'
import type {
  BibliographyEntry,
  BibliographyStyle,
  FileFormat,
  WorkspaceBibliographyState,
  WorkspaceDocumentSummary,
  WorkspaceLibraryData,
  WorkspaceRelations
} from '../shared/types.js'

const BIBLIOGRAPHY_FILE = '.prosa-bibliography.json'
const IGNORED_DIRS = new Set(['node_modules', '.git'])

interface ParsedDocument {
  summary: WorkspaceDocumentSummary
  keys: string[]
  titleKeys: string[]
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/]+/g, '/')
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitList(item))
  }
  if (typeof value !== 'string') return []
  return value
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeLinkTarget(value: string): string {
  return value.split('|')[0]?.split('#')[0]?.trim() ?? value.trim()
}

function parseTextFormat(content: string, format: FileFormat): {
  title: string
  body: string
  tags: string[]
  collections: string[]
  citations: string[]
  links: string[]
  excerpt: string
} {
  if (format === 'md') {
    const parsed = parseFrontmatter(content)
    const title = parsed.frontmatter.title ?? ''
    const tags = splitList(parsed.frontmatter.tags)
    const collections = splitList(parsed.frontmatter.collections ?? parsed.frontmatter.collection)
    const citations = [...new Set(content.match(/\[@([^\]]+)\]/g)?.map((match) => match.slice(2, -1).trim()) ?? [])]
    const links = [
      ...new Set(content.match(/\[\[([^\]]+)\]\]/g)?.map((match) => normalizeLinkTarget(match.slice(2, -2))) ?? [])
    ]
    return {
      title,
      body: parsed.body,
      tags,
      collections,
      citations,
      links,
      excerpt: parsed.body.replace(/\s+/g, ' ').trim().slice(0, 180)
    }
  }

  const parsed = JSON.parse(content) as {
    metadata?: { title?: string }
    frontmatter?: Record<string, string>
    content?: unknown
  }
  const frontmatter = typeof parsed.frontmatter === 'object' && parsed.frontmatter !== null ? parsed.frontmatter : {}
  const title = parsed.metadata?.title ?? frontmatter.title ?? ''
  const tags = splitList(frontmatter.tags)
  const collections = splitList(frontmatter.collections ?? frontmatter.collection)
  const json = typeof parsed.content === 'object' && parsed.content !== null ? (parsed.content as never) : null
  const doc = json && typeof json === 'object' ? (json as Parameters<typeof documentText>[0]) : undefined
  const citations = doc ? extractCitations(doc) : []
  const links = doc ? extractWikilinks(doc) : []
  const excerpt = doc ? documentText(doc).replace(/\s+/g, ' ').trim().slice(0, 180) : ''
  return { title, body: '', tags, collections, citations, links, excerpt }
}

async function collectFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === BIBLIOGRAPHY_FILE) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.prosa-')) continue
      files.push(...(await collectFiles(root, full)))
    } else {
      files.push(full)
    }
  }
  return files
}

async function readSummary(root: string, path: string): Promise<ParsedDocument | null> {
  const format = detectFormat(path)
  if (!['prosa', 'md', 'txt'].includes(format)) {
    const stats = await stat(path)
    const name = basename(path)
    const title = name.replace(/\.[^.]+$/, '')
    const summary: WorkspaceDocumentSummary = {
      path,
      name,
      title,
      format,
      modifiedAt: stats.mtime.toISOString(),
      tags: [],
      collections: [],
      citations: [],
      links: [],
      excerpt: ''
    }
    return { summary, keys: [normalizeKey(path), normalizeKey(relative(root, path))], titleKeys: [normalizeKey(title)] }
  }

  const stats = await stat(path)
  const name = basename(path)
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = parseTextFormat(raw, format)
    const title = parsed.title || name.replace(/\.[^.]+$/, '')
    const rel = relative(root, path)
    const summary: WorkspaceDocumentSummary = {
      path,
      name,
      title,
      format,
      modifiedAt: stats.mtime.toISOString(),
      tags: parsed.tags,
      collections: parsed.collections,
      citations: parsed.citations,
      links: parsed.links,
      excerpt: parsed.excerpt || title
    }
    return {
      summary,
      keys: [
        normalizeKey(path),
        normalizeKey(rel),
        normalizeKey(name),
        normalizeKey(name.replace(/\.[^.]+$/, ''))
      ],
      titleKeys: [normalizeKey(title)]
    }
  } catch {
    const title = name.replace(/\.[^.]+$/, '')
    const summary: WorkspaceDocumentSummary = {
      path,
      name,
      title,
      format,
      modifiedAt: stats.mtime.toISOString(),
      tags: [],
      collections: [],
      citations: [],
      links: [],
      excerpt: ''
    }
    return {
      summary,
      keys: [
        normalizeKey(path),
        normalizeKey(relative(root, path)),
        normalizeKey(name),
        normalizeKey(name.replace(/\.[^.]+$/, ''))
      ],
      titleKeys: [normalizeKey(title)]
    }
  }
}

function defaultBibliography(): WorkspaceBibliographyState {
  return { style: 'ABNT', importedAt: null, entries: [] }
}

async function readBibliography(root: string): Promise<WorkspaceBibliographyState> {
  try {
    const raw = await readFile(join(root, BIBLIOGRAPHY_FILE), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceBibliographyState>
    return {
      style: parsed.style === 'APA' || parsed.style === 'IEEE' ? parsed.style : 'ABNT',
      importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : null,
      entries: Array.isArray(parsed.entries) ? (parsed.entries as BibliographyEntry[]) : []
    }
  } catch {
    return defaultBibliography()
  }
}

async function writeBibliography(root: string, state: WorkspaceBibliographyState): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, BIBLIOGRAPHY_FILE), JSON.stringify(state, null, 2), 'utf-8')
}

function resolveKeys(documents: ParsedDocument[]): Map<string, WorkspaceDocumentSummary> {
  const map = new Map<string, WorkspaceDocumentSummary>()
  for (const doc of documents) {
    for (const key of doc.keys) map.set(key, doc.summary)
    for (const key of doc.titleKeys) map.set(key, doc.summary)
  }
  return map
}

function relationsFor(target: WorkspaceDocumentSummary, docs: ParsedDocument[]): WorkspaceRelations {
  const byKey = resolveKeys(docs)
  const targetKeys = new Set([
    normalizeKey(target.path),
    normalizeKey(target.name),
    normalizeKey(target.name.replace(/\.[^.]+$/, '')),
    normalizeKey(target.title)
  ])

  const backlinks: WorkspaceDocumentSummary[] = []
  const related = new Map<string, WorkspaceDocumentSummary>()
  const brokenLinks = new Set<string>()

  for (const doc of docs) {
    if (doc.summary.path === target.path) continue
    const outgoing = doc.summary.links
    const matchesTarget = outgoing.some((link) => {
      const resolved = byKey.get(normalizeKey(normalizeLinkTarget(link)))
      if (resolved?.path === target.path) return true
      return targetKeys.has(normalizeKey(normalizeLinkTarget(link)))
    })
    if (matchesTarget) backlinks.push(doc.summary)

    const sharedTags = doc.summary.tags.some((tag) => target.tags.includes(tag))
    const sharedCollections = doc.summary.collections.some((item) => target.collections.includes(item))
    const sharedCitations = doc.summary.citations.some((cite) => target.citations.includes(cite))
    if (sharedTags || sharedCollections || sharedCitations) {
      related.set(doc.summary.path, doc.summary)
    }

    for (const link of outgoing) {
      const resolved = byKey.get(normalizeKey(normalizeLinkTarget(link)))
      if (!resolved) brokenLinks.add(link)
    }
  }

  related.delete(target.path)
  backlinks.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))

  return {
    backlinks,
    related: [...related.values()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')).slice(0, 12),
    brokenLinks: [...brokenLinks].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }
}

/** Lê a biblioteca completa do workspace atual. */
export async function getWorkspaceLibrary(): Promise<WorkspaceLibraryData> {
  const root = app.isReady() ? getSettings().workspacePath ?? null : null
  if (!root) {
    return {
      root: null,
      documents: [],
      recentFiles: getRecentFiles(),
      pinnedFiles: getPinnedFiles(),
      bibliography: defaultBibliography(),
      error: null
    }
  }

  try {
    const files = await collectFiles(root)
    const parsedDocs: ParsedDocument[] = []
    for (const file of files) {
      const summary = await readSummary(root, file)
      if (summary) parsedDocs.push(summary)
    }
    const bibliography = await readBibliography(root)
    return {
      root,
      documents: parsedDocs.map((doc) => doc.summary).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
      recentFiles: getRecentFiles(),
      pinnedFiles: getPinnedFiles(),
      bibliography,
      error: null
    }
  } catch (error) {
    return {
      root,
      documents: [],
      recentFiles: getRecentFiles(),
      pinnedFiles: getPinnedFiles(),
      bibliography: await readBibliography(root),
      error: (error as Error).message
    }
  }
}

/** Retorna backlinks, relações e links quebrados de um documento. */
export async function getWorkspaceRelations(path: string): Promise<WorkspaceRelations> {
  const settings = getSettings()
  if (!settings.workspacePath) return { backlinks: [], related: [], brokenLinks: [] }
  try {
    const files = await collectFiles(settings.workspacePath)
    const docs: ParsedDocument[] = []
    for (const file of files) {
      const summary = await readSummary(settings.workspacePath, file)
      if (summary) docs.push(summary)
    }
    const target = docs.find((doc) => doc.summary.path === resolve(path) || doc.summary.path === path)
    if (!target) return { backlinks: [], related: [], brokenLinks: [] }
    return relationsFor(target.summary, docs)
  } catch {
    return { backlinks: [], related: [], brokenLinks: [] }
  }
}

/** Importa BibTeX para a biblioteca local do workspace. */
export async function importBibTeX(root: string, content: string): Promise<WorkspaceBibliographyState> {
  const bibliography = await readBibliography(root)
  const entries = parseBibTeX(content)
  const merged = new Map<string, BibliographyEntry>()
  for (const entry of bibliography.entries) merged.set(entry.key, entry)
  for (const entry of entries) merged.set(entry.key, entry)
  const updated: WorkspaceBibliographyState = {
    style: bibliography.style,
    importedAt: new Date().toISOString(),
    entries: [...merged.values()].sort((a, b) => a.key.localeCompare(b.key, 'pt-BR'))
  }
  await writeBibliography(root, updated)
  return updated
}

/** Atualiza o estilo da bibliografia persistida. */
export async function setBibliographyStyle(root: string, style: BibliographyStyle): Promise<WorkspaceBibliographyState> {
  const bibliography = await readBibliography(root)
  const updated = { ...bibliography, style }
  await writeBibliography(root, updated)
  return updated
}

/** Gera uma bibliografia em texto simples para uma lista de chaves. */
export function renderBibliography(
  keys: string[],
  entries: BibliographyEntry[],
  style: BibliographyStyle
): string[] {
  const map = new Map(entries.map((entry) => [entry.key, entry]))
  const unique = [...new Set(keys)].filter((key) => map.has(key))
  return unique.map((key, index) => formatBibliographyEntry(map.get(key)!, style, index + 1))
}
