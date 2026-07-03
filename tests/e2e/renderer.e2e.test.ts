// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'

interface E2EContext {
  app: ElectronApplication
  page: Page
  filePath: string
  tempRoot: string
}

const REPO_ROOT = process.cwd()

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  stepMs = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
  throw new Error('Tempo esgotado aguardando condição de teste E2E')
}

async function getMainPage(app: ElectronApplication): Promise<Page> {
  await waitFor(async () => app.windows().length > 0, 10000)

  for (let i = 0; i < 40; i += 1) {
    for (const page of app.windows()) {
      const url = page.url()
      if (url.includes('index.html')) {
        await page.waitForLoadState('domcontentloaded')
        return page
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error('Janela principal do renderer não encontrada')
}

async function launchAppWithRecentDocument(options: {
  fileName: string
  initialContent: string
  settings?: Record<string, unknown>
}): Promise<E2EContext> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'prosa-e2e-'))
  const docsDir = join(tempRoot, 'docs')
  const configRoot = join(tempRoot, 'config')
  const appConfigDir = join(configRoot, 'Prosa')

  await mkdir(docsDir, { recursive: true })
  await mkdir(appConfigDir, { recursive: true })

  const filePath = join(docsDir, options.fileName)
  await writeFile(filePath, options.initialContent, 'utf-8')

  const settingsPath = join(appConfigDir, 'prosa-settings.json')
  const now = new Date().toISOString()
  const settings = {
    recentFiles: [
      {
        path: filePath,
        name: options.fileName,
        modifiedAt: now
      }
    ],
    showOutline: true,
    showWordCount: true,
    autoSavePolicy: 'debounce',
    autoSaveDebounceSeconds: 1,
    autoSaveIntervalMinutes: 5,
    ...(options.settings ?? {})
  }
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')

  const app = await electron.launch({
    cwd: REPO_ROOT,
    args: ['.'],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configRoot
    }
  })

  const page = await getMainPage(app)
  await page.waitForSelector('#welcome-new')

  return { app, page, filePath, tempRoot }
}

async function openRecentDocument(page: Page): Promise<void> {
  const recentItem = page.locator('.recent-item').first()
  await recentItem.waitFor({ state: 'visible' })
  await recentItem.click()

  await page.waitForFunction(() => {
    const el = document.getElementById('document-view')
    return !!el && !el.hasAttribute('hidden')
  })
  await page.waitForSelector('#editor .ProseMirror')
}

test('E2E renderer: abrir documento, find/replace e toggles de painel/distraction-free', async () => {
  const ctx = await launchAppWithRecentDocument({
    fileName: 'fluxo-ui.txt',
    initialContent: 'banana banana'
  })

  try {
    await openRecentDocument(ctx.page)

    const editor = ctx.page.locator('#editor .ProseMirror')
    await editor.click()

    await ctx.page.keyboard.press('Control+h')
    await ctx.page.waitForSelector('.find-replace-panel.show-replace:not([hidden])')

    await ctx.page.locator('.fr-find').fill('banana')
    await ctx.page.locator('.fr-replace').fill('pera')
    await ctx.page.locator('.fr-replace-all').click()

    await waitFor(async () => {
      const text = await editor.innerText()
      return text.includes('pera pera')
    })

    await ctx.page.keyboard.press('Control+Shift+O')
    await waitFor(async () => await ctx.page.locator('#outline-panel').evaluate((el) => el.hasAttribute('hidden')))

    await ctx.page.keyboard.press('Control+Shift+D')
    await waitFor(async () => await ctx.page.locator('#document-view').evaluate((el) => el.classList.contains('distraction-free')))

    await ctx.page.keyboard.press('Control+Shift+D')
    await waitFor(async () => !(await ctx.page.locator('#document-view').evaluate((el) => el.classList.contains('distraction-free'))))
  } finally {
    await ctx.app.close()
    await rm(ctx.tempRoot, { recursive: true, force: true })
  }
})

test('E2E renderer: abrir documento, salvar manual e autosave por debounce', async () => {
  const ctx = await launchAppWithRecentDocument({
    fileName: 'autosave.txt',
    initialContent: 'base'
  })

  try {
    await openRecentDocument(ctx.page)

    const editor = ctx.page.locator('#editor .ProseMirror')
    await editor.click()

    await ctx.page.keyboard.press('Control+a')
    await ctx.page.keyboard.type('manual save marker')
    await ctx.page.keyboard.press('Control+s')

    await waitFor(async () => {
      const saved = await readFile(ctx.filePath, 'utf-8')
      return saved.includes('manual save marker')
    }, 7000)

    await editor.click()
    await ctx.page.keyboard.type(' autosave marker')

    await waitFor(async () => {
      const saved = await readFile(ctx.filePath, 'utf-8')
      return saved.includes('autosave marker')
    }, 7000)

    const finalContent = await readFile(ctx.filePath, 'utf-8')
    assert.match(finalContent, /manual save marker.*autosave marker/s)
  } finally {
    await ctx.app.close()
    await rm(ctx.tempRoot, { recursive: true, force: true })
  }
})
