// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { exportPdf } from './export-service.js'
import { exportEpubDocument } from './epub-export-service.js'
import { exportHtmlDocument } from './html-export-service.js'
import { openDocument } from './open-service.js'
import { saveDocument } from './save-service.js'
import { listVersions, getVersionText } from './version-history.js'
import { setupSyncWatcher, markSelfWrite, stopSyncWatcher } from './sync-watcher.js'
import {
  getRecentFiles,
  getSettings,
  setSettings,
  clearRecentFiles,
  clearPinnedFiles,
  getPinnedFiles,
  pinFile,
  unpinFile,
  saveFontProfile,
  deleteFontProfile
} from './settings.js'
import { getAvailableTemplates, getTemplateContent, saveTemplate, deleteTemplate } from './templates.js'
import { loadPlugins, unloadPlugins, getAvailablePlugins, enablePlugin, disablePlugin, removePlugin } from './plugins.js'
import { initUpdater } from './updater.js'
import { listSystemFonts } from './fonts.js'
import { attachSpellCheckContextMenu, configureSpellChecker } from './spellcheck.js'
import { getWorkspaceLibrary, getWorkspaceRelations, importBibTeX, setBibliographyStyle, updateWorkspaceCollections } from './workspace.js'
import type { AppInfo, FontProfile, HtmlExportOptions, NoteEntry, RecentFile, SavePayload, TipTapJSON } from '../shared/types.js'

if (process.platform === 'win32') {
  app.setAppUserModelId('br.com.Rodrigo Brito.prosa')
}

const isMac = process.platform === 'darwin'

/** Informações da aplicação exibidas na tela "Sobre". */
const APP_INFO: AppInfo = {
  name: 'Prosa',
  version: app.getVersion(),
  license: 'GPLv3',
  company: 'Rodrigo Brito',
  website: 'https://github.com/britors/Prosa',
  github: 'https://github.com/britors/prosa',
  support: 'rodrigo@w3ti.com.br',
  copyright: '© 2026 Rodrigo Brito'
}

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
/** Momento em que a splash foi exibida (para garantir tempo mínimo). */
let splashShownAt = 0
/** Tempo mínimo, em ms, que a splash permanece visível. */
const SPLASH_MIN_MS = 1400
/** Referência para o timer de autosave. */
let autosaveTimer: NodeJS.Timeout | null = null
/** Indica se o documento atual possui alterações não salvas. */
let documentDirty = false
/** Intervalos disponíveis para autosave por inatividade (segundos). */
const AUTOSAVE_DEBOUNCE_OPTIONS = [10, 30, 60, 120]
/** Intervalos disponíveis para autosave periódico (minutos). */
const AUTOSAVE_INTERVAL_OPTIONS = [1, 5, 15, 30]
/** Quantidade de versões mantidas no backup automático. */
const BACKUP_KEEP_OPTIONS = [5, 10, 20, 50]
/** Durações disponíveis para a fase de trabalho do timer de foco (minutos). */
const FOCUS_WORK_OPTIONS = [15, 25, 45, 60]
/** Durações disponíveis para a fase de pausa do timer de foco (minutos). */
const FOCUS_BREAK_OPTIONS = [5, 10, 15]
/** Metas de palavras disponíveis para a barra de progresso (0 = desativada). */
const WORD_GOAL_OPTIONS = [0, 500, 1000, 2500, 5000]

/** Gerencia o timer de autosave com base nas configurações atuais. */
function setupAutosave(): void {
  if (autosaveTimer) clearInterval(autosaveTimer)
  autosaveTimer = null

  const settings = getSettings()
  if (settings.autoSavePolicy === 'interval' && settings.autoSaveIntervalMinutes > 0) {
    autosaveTimer = setInterval(() => {
      if (documentDirty && mainWindow) {
        // Solicita o conteúdo atual ao renderer para salvar
        mainWindow.webContents.send('menu:action', 'file:autoSave')
      }
    }, settings.autoSaveIntervalMinutes * 60 * 1000)
  }
}

/** Notifica o renderer sobre uma mudança externa num arquivo da pasta de sincronização. */
function notifySyncChange(path: string): void {
  mainWindow?.webContents.send('menu:action', 'sync:fileChanged', path)
}

/** Busca texto em todos os arquivos de uma pasta. */
async function searchInFiles(dir: string, term: string): Promise<{ path: string; snippet: string }[]> {
  const results: { path: string; snippet: string }[] = []
  const files = await readdir(dir)
  for (const file of files) {
    const path = join(dir, file)
    const stats = await stat(path)
    if (stats.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results.push(...(await searchInFiles(path, term)))
      }
    } else if (file.endsWith('.prosa') || file.endsWith('.md') || file.endsWith('.txt')) {
      const content = await readFile(path, 'utf-8')
      if (content.includes(term)) {
        const index = content.indexOf(term)
        const snippet = content.substring(Math.max(0, index - 20), Math.min(content.length, index + term.length + 20))
        results.push({ path, snippet })
      }
    }
  }
  return results
}

/** Caminho do ícone da aplicação (gerado a partir do logo). */
const ICON_PATH = join(__dirname, '..', 'icon.png')

/** Envia uma ação de menu para o renderer tratar. */
function sendMenuAction(action: string, payload?: unknown): void {
  mainWindow?.webContents.send('menu:action', action, payload)
}

/** Atualiza preferências de autosave, reaplica timers e notifica o renderer. */
function applyAutosaveSettings(partial: {
  autoSavePolicy?: 'off' | 'onBlur' | 'debounce' | 'interval'
  autoSaveDebounceSeconds?: number
  autoSaveIntervalMinutes?: number
}): void {
  const updated = setSettings(partial)

  setupAutosave()
  buildMenu()
  sendMenuAction('settings:updated', {
    autoSavePolicy: updated.autoSavePolicy,
    autoSaveDebounceSeconds: updated.autoSaveDebounceSeconds,
    autoSaveIntervalMinutes: updated.autoSaveIntervalMinutes
  })
}

/** Atualiza preferências de backup automático. */
function applyBackupSettings(partial: {
  backupOnSave?: boolean
  backupKeepVersions?: number
}): void {
  setSettings(partial)
  buildMenu()
}

/** Atualiza preferências de exportação PDF. */
function applyPdfSettings(partial: {
  pdfPageSize?: 'A4' | 'Letter' | 'Legal'
  pdfLandscape?: boolean
  pdfPrintBackground?: boolean
}): void {
  setSettings(partial)
  buildMenu()
}

/** Atualiza preferências do timer de foco e notifica o renderer das novas durações. */
function applyFocusTimerSettings(partial: {
  focusWorkMinutes?: number
  focusBreakMinutes?: number
}): void {
  const updated = setSettings(partial)
  buildMenu()
  sendMenuAction('settings:updated', {
    focusWorkMinutes: updated.focusWorkMinutes,
    focusBreakMinutes: updated.focusBreakMinutes
  })
}

/** Atualiza a meta de palavras e notifica o renderer. */
function applyWordGoalSettings(partial: { wordGoal: number }): void {
  const updated = setSettings(partial)
  buildMenu()
  sendMenuAction('settings:updated', { wordGoal: updated.wordGoal })
}

/** Cria e exibe a janela de splash com o logo enquanto o app carrega. */
function createSplash(): void {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 340,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#0F1117',
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  void splashWindow.loadFile(join(__dirname, '../renderer/splash.html'))
  splashWindow.once('ready-to-show', () => {
    splashWindow?.show()
    splashShownAt = Date.now()
  })
  splashWindow.on('closed', () => {
    splashWindow = null
  })
}

/** Fecha a splash (respeitando o tempo mínimo) e revela a janela principal. */
function finishSplash(): void {
  const elapsed = Date.now() - (splashShownAt || Date.now())
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed)
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
    mainWindow?.show()
  }, wait)
}

/** Cria a janela principal da aplicação. */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0F1117',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  mainWindow.once('ready-to-show', () => {
    finishSplash()
  })

  mainWindow.on('close', (event) => {
    if (documentDirty) {
      event.preventDefault()
      void confirmUnsaved().then((shouldClose) => {
        if (shouldClose) {
          documentDirty = false
          mainWindow?.close()
        }
      })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Corretor ortográfico nativo (sublinhado + sugestões no menu de contexto).
  const settings = getSettings()
  configureSpellChecker(settings.spellcheck, settings.spellLanguages)
  attachSpellCheckContextMenu(mainWindow)

  buildMenu()
  initUpdater(mainWindow)
  setupAutosave()
  setupSyncWatcher(notifySyncChange)

  // Inicializa o gerenciador de plugins (nunca deve derrubar a janela principal)
  void loadPlugins().catch((err) => console.error('[plugins] Erro inesperado ao carregar plugins:', err))
}

/** Abre o diálogo de impressão do sistema para o documento atual. */
function handlePrint(): void {
  if (!mainWindow) return
  // printBackground: false → usa o CSS @media print (papel branco).
  mainWindow.webContents.print({ printBackground: false, silent: false }, (success, reason) => {
    if (!success && reason && reason !== 'cancelled' && mainWindow) {
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Erro ao imprimir',
        message: 'Não foi possível imprimir o documento.',
        detail: reason
      })
    }
  })
}

/** Alterna a verificação ortográfica e persiste a preferência. */
function toggleSpellcheck(): void {
  const current = getSettings()
  const enabled = !current.spellcheck
  setSettings({ spellcheck: enabled })
  configureSpellChecker(enabled, current.spellLanguages)
  buildMenu()
}

/** Mostra o diálogo de confirmação de alterações não salvas. */
async function confirmUnsaved(): Promise<boolean> {
  if (!mainWindow) return true
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Salvar', 'Descartar', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
    title: 'Alterações não salvas',
    message: 'O documento possui alterações não salvas.',
    detail: 'Deseja salvar antes de fechar?'
  })
  if (response === 0) {
    sendMenuAction('file:save')
    return false
  }
  return response === 1
}

/** Constrói e aplica o menu nativo da aplicação. */
function buildMenu(): void {
  const settings = getSettings()
  const recent = getRecentFiles()
  const recentItems: MenuItemConstructorOptions[] =
    recent.length > 0
      ? [
          ...recent.map((file) => ({
            label: file.name,
            click: () => void handleOpen(file.path)
          })),
          { type: 'separator' as const },
          {
            label: 'Limpar recentes',
            click: () => {
              clearRecentFiles()
              buildMenu()
              mainWindow?.webContents.send('menu:action', 'file:recentCleared')
            }
          }
        ]
      : [{ label: 'Nenhum arquivo recente', enabled: false }]
  const pinned = getPinnedFiles()
  const pinnedItems: MenuItemConstructorOptions[] =
    pinned.length > 0
      ? [
          ...pinned.map((file) => ({
            label: file.name,
            click: () => void handleOpen(file.path)
          })),
          { type: 'separator' as const },
          {
            label: 'Limpar fixados',
            click: () => {
              clearPinnedFiles()
              buildMenu()
              mainWindow?.webContents.send('menu:action', 'file:recentCleared')
            }
          }
        ]
      : [{ label: 'Nenhum arquivo fixado', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Prosa',
            submenu: [
              { role: 'about' as const, label: 'Sobre o Prosa' },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'quit' as const, label: 'Sair' }
            ]
          }
        ]
      : []),
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Novo',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('file:new')
        },
        {
          label: 'Novo trabalho ABNT',
          click: () => sendMenuAction('file:newAbnt')
        },
        {
          label: 'Abrir...',
          accelerator: 'CmdOrCtrl+O',
          click: () => void handleOpen()
        },
        {
          label: 'Salvar',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('file:save')
        },
        {
          label: 'Salvar como...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('file:saveAs')
        },
        {
          label: 'Salvamento automático',
          submenu: [
            {
              label: 'Desativado',
              type: 'radio',
              checked: settings.autoSavePolicy === 'off',
              click: () => applyAutosaveSettings({ autoSavePolicy: 'off' })
            },
            {
              label: 'Ao perder foco',
              type: 'radio',
              checked: settings.autoSavePolicy === 'onBlur',
              click: () => applyAutosaveSettings({ autoSavePolicy: 'onBlur' })
            },
            {
              label: 'Após inatividade',
              type: 'radio',
              checked: settings.autoSavePolicy === 'debounce',
              click: () => applyAutosaveSettings({ autoSavePolicy: 'debounce' })
            },
            {
              label: 'Em intervalo fixo',
              type: 'radio',
              checked: settings.autoSavePolicy === 'interval',
              click: () => applyAutosaveSettings({ autoSavePolicy: 'interval' })
            },
            { type: 'separator' },
            {
              label: 'Intervalo por inatividade',
              submenu: AUTOSAVE_DEBOUNCE_OPTIONS.map((seconds) => ({
                label: `${seconds} s`,
                type: 'radio' as const,
                checked: settings.autoSaveDebounceSeconds === seconds,
                click: () =>
                  applyAutosaveSettings({
                    autoSavePolicy: 'debounce',
                    autoSaveDebounceSeconds: seconds
                  })
              }))
            },
            {
              label: 'Intervalo fixo',
              submenu: AUTOSAVE_INTERVAL_OPTIONS.map((minutes) => ({
                label: `${minutes} min`,
                type: 'radio' as const,
                checked: settings.autoSaveIntervalMinutes === minutes,
                click: () =>
                  applyAutosaveSettings({
                    autoSavePolicy: 'interval',
                    autoSaveIntervalMinutes: minutes
                  })
              }))
            }
          ]
        },
        {
          label: 'Backups automáticos',
          submenu: [
            {
              label: 'Ativar backup ao salvar',
              type: 'checkbox',
              checked: settings.backupOnSave,
              click: () => applyBackupSettings({ backupOnSave: !settings.backupOnSave })
            },
            { type: 'separator' },
            {
              label: 'Manter versões',
              submenu: BACKUP_KEEP_OPTIONS.map((count) => ({
                label: `${count}`,
                type: 'radio' as const,
                checked: settings.backupKeepVersions === count,
                click: () => applyBackupSettings({ backupKeepVersions: count })
              }))
            }
          ]
        },
        {
          label: 'Sincronização',
          submenu: [
            {
              label: 'Escolher pasta...',
              click: () => sendMenuAction('sync:choose')
            },
            {
              label: 'Desativar sincronização',
              enabled: !!settings.syncPath,
              click: () => sendMenuAction('sync:disable')
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Exportar PDF',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendMenuAction('file:exportPdf')
        },
        {
          label: 'Exportar HTML limpo',
          click: () => sendMenuAction('file:exportHtml')
        },
        {
          label: 'Exportar EPUB',
          click: () => sendMenuAction('file:exportEpub')
        },
        {
          label: 'Configurações de PDF',
          submenu: [
            {
              label: 'Tamanho da página',
              submenu: ['A4', 'Letter', 'Legal'].map((size) => ({
                label: size,
                type: 'radio' as const,
                checked: settings.pdfPageSize === size,
                click: () => applyPdfSettings({ pdfPageSize: size as 'A4' | 'Letter' | 'Legal' })
              }))
            },
            {
              label: 'Orientação paisagem',
              type: 'checkbox',
              checked: settings.pdfLandscape,
              click: () => applyPdfSettings({ pdfLandscape: !settings.pdfLandscape })
            },
            {
              label: 'Imprimir fundo',
              type: 'checkbox',
              checked: settings.pdfPrintBackground,
              click: () => applyPdfSettings({ pdfPrintBackground: !settings.pdfPrintBackground })
            }
          ]
        },
        {
          label: 'Imprimir...',
          accelerator: 'CmdOrCtrl+P',
          click: () => handlePrint()
        },
        { label: 'Arquivos fixados', submenu: pinnedItems },
        { label: 'Arquivos recentes', submenu: recentItems },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fechar' } : { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
        {
          label: 'Paleta de Comandos',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendMenuAction('edit:commandPalette')
        },
        { type: 'separator' },
        // ...
        {
          label: 'Alternar Workspace...',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => sendMenuAction('workspace:switch')
        },
        {
          label: 'Timer de Foco',
          submenu: [
            {
              label: 'Duração do trabalho',
              submenu: FOCUS_WORK_OPTIONS.map((minutes) => ({
                label: `${minutes} min`,
                type: 'radio' as const,
                checked: settings.focusWorkMinutes === minutes,
                click: () => applyFocusTimerSettings({ focusWorkMinutes: minutes })
              }))
            },
            {
              label: 'Duração da pausa',
              submenu: FOCUS_BREAK_OPTIONS.map((minutes) => ({
                label: `${minutes} min`,
                type: 'radio' as const,
                checked: settings.focusBreakMinutes === minutes,
                click: () => applyFocusTimerSettings({ focusBreakMinutes: minutes })
              }))
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Localizar',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenuAction('edit:find')
        },
        // ...
        {
          label: 'Substituir',
          accelerator: 'CmdOrCtrl+H',
          click: () => sendMenuAction('edit:replace')
        },
        {
          label: 'Pesquisar',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => sendMenuAction('edit:search')
        }
      ]
    },
    {
      label: 'Formatar',
      submenu: [
        { label: 'Negrito', accelerator: 'CmdOrCtrl+B', click: () => sendMenuAction('format:bold') },
        { label: 'Itálico', accelerator: 'CmdOrCtrl+I', click: () => sendMenuAction('format:italic') },
        { label: 'Sublinhado', accelerator: 'CmdOrCtrl+U', click: () => sendMenuAction('format:underline') },
        { label: 'Tachado', click: () => sendMenuAction('format:strike') },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6].map((level) => ({
          label: `Título ${level}`,
          accelerator: `CmdOrCtrl+Alt+${level}`,
          click: () => sendMenuAction('format:heading', level)
        })),
        { type: 'separator' },
        { label: 'Alinhar à esquerda', click: () => sendMenuAction('format:align', 'left') },
        { label: 'Centralizar', click: () => sendMenuAction('format:align', 'center') },
        { label: 'Alinhar à direita', click: () => sendMenuAction('format:align', 'right') },
        { label: 'Justificar', click: () => sendMenuAction('format:align', 'justify') },
        { type: 'separator' },
        { label: 'Lista não ordenada', click: () => sendMenuAction('format:bulletList') },
        { label: 'Lista ordenada', click: () => sendMenuAction('format:orderedList') },
        { type: 'separator' },
        {
          label: 'Tabela',
          submenu: [
            { label: 'Inserir tabela', click: () => sendMenuAction('table:insert') },
            { label: 'Adicionar linha', click: () => sendMenuAction('table:addRow') },
            { label: 'Adicionar coluna', click: () => sendMenuAction('table:addColumn') },
            { label: 'Remover linha', click: () => sendMenuAction('table:deleteRow') },
            { label: 'Remover coluna', click: () => sendMenuAction('table:deleteColumn') }
          ]
        }
      ]
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Ampliar', accelerator: 'CmdOrCtrl+Plus', click: () => sendMenuAction('view:zoomIn') },
        { label: 'Reduzir', accelerator: 'CmdOrCtrl+-', click: () => sendMenuAction('view:zoomOut') },
        { label: 'Restaurar zoom', accelerator: 'CmdOrCtrl+0', click: () => sendMenuAction('view:zoomReset') },
        { type: 'separator' },
        { label: 'Alternar tópicos', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenuAction('view:toggleOutline') },
        { label: 'Alternar painel de estilos', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('view:toggleStyles') },
        {
          label: 'Notas',
          type: 'checkbox',
          checked: settings.showNotes,
          click: () => sendMenuAction('view:toggleNotes')
        },
        {
          label: 'Relações do workspace',
          type: 'checkbox',
          checked: settings.showRelations,
          click: () => sendMenuAction('view:toggleRelations')
        },
        { label: 'Alternar contagem de palavras', click: () => sendMenuAction('view:toggleWordCount') },
        {
          label: 'Biblioteca do Workspace',
          click: () => sendMenuAction('workspace:library')
        },
        {
          label: 'Meta de Palavras',
          submenu: WORD_GOAL_OPTIONS.map((goal) => ({
            label: goal === 0 ? 'Nenhuma' : `${goal} palavras`,
            type: 'radio' as const,
            checked: settings.wordGoal === goal,
            click: () => applyWordGoalSettings({ wordGoal: goal })
          }))
        },
        {
          label: 'Modo sem distrações',
          accelerator: 'CmdOrCtrl+Shift+D',
          type: 'checkbox',
          checked: settings.distractionFree,
          click: () => sendMenuAction('view:toggleDistractionFree')
        },
        {
          label: 'Verificar ortografia',
          type: 'checkbox',
          checked: settings.spellcheck,
          click: () => toggleSpellcheck()
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre o Prosa',
          click: () => sendMenuAction('help:about')
        },
        {
          label: 'Licença GPLv3',
          click: () => void shell.openExternal('https://www.gnu.org/licenses/gpl-3.0.html')
        },
        {
          label: 'GitHub',
          click: () => void shell.openExternal(APP_INFO.github)
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Abre um arquivo e notifica o renderer com o conteúdo. */
async function handleOpen(path?: string): Promise<void> {
  if (!mainWindow) return
  const result = await openDocument(mainWindow, path)
  if (result.ok) {
    mainWindow.webContents.send('menu:action', 'document:loaded', result.document)
    buildMenu()
  } else if (result.error) {
    void dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Erro ao abrir',
      message: 'Não foi possível abrir o arquivo.',
      detail: result.error
    })
  }
}

/** Registra todos os handlers IPC. */
function registerIpc(): void {
  ipcMain.handle('file:new', () => {
    documentDirty = false
    return { ok: true }
  })

  ipcMain.handle('file:open', async (_event, path?: string) => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    const result = await openDocument(mainWindow, path)
    if (result.ok) buildMenu()
    return result
  })

  ipcMain.handle('file:save', async (_event, payload: SavePayload) => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    const result = await saveDocument(mainWindow, payload, false)
    if (result.ok) {
      documentDirty = false
      if (result.path) markSelfWrite(result.path)
      buildMenu()
    }
    return result
  })

  ipcMain.handle('file:saveAs', async (_event, payload: SavePayload) => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    const result = await saveDocument(mainWindow, payload, true)
    if (result.ok) {
      documentDirty = false
      if (result.path) markSelfWrite(result.path)
      buildMenu()
    }
    return result
  })

  ipcMain.handle('file:exportPdf', async (_event, defaultName: string, preset?: 'academic' | 'report' | 'contract' | 'book') => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    const settings = getSettings()
    return exportPdf(mainWindow, defaultName, {
      preset: preset ?? settings.pdfPreset,
      pageSize: settings.pdfPageSize,
      landscape: settings.pdfLandscape,
      printBackground: settings.pdfPrintBackground
    })
  })

  ipcMain.handle('file:exportHtml', async (_event, defaultName: string, doc: TipTapJSON, options: HtmlExportOptions, notes?: Record<string, NoteEntry>) => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    return exportHtmlDocument(mainWindow, defaultName, doc, options, notes)
  })

  ipcMain.handle('file:exportEpub', async (_event, defaultName: string, payload: SavePayload) => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    return exportEpubDocument(mainWindow, defaultName, payload)
  })

  ipcMain.handle('file:print', () => {
    handlePrint()
    return { ok: true }
  })

  ipcMain.handle('file:recent', () => getRecentFiles())
  ipcMain.handle('file:clearRecent', () => {
    const updated = clearRecentFiles()
    buildMenu()
    // Notifica o renderer para atualizar a tela de boas-vindas se estiver aberta
    mainWindow?.webContents.send('menu:action', 'file:recentCleared')
    return updated
  })
  ipcMain.handle('templates:list', () => getAvailableTemplates())
  ipcMain.handle('templates:get', (_event, id: string) => getTemplateContent(id))
  ipcMain.handle('templates:save', (_event, name: string, css: string) => saveTemplate(name, css))
  ipcMain.handle('templates:delete', (_event, id: string) => deleteTemplate(id))
  ipcMain.handle('file:pinned', () => getPinnedFiles())
  ipcMain.handle('file:clearPinned', () => clearPinnedFiles())
  ipcMain.handle('file:pin', (_event, file: RecentFile) => pinFile(file))
  ipcMain.handle('file:unpin', (_event, path: string) => unpinFile(path))
  ipcMain.handle('file:search', async (_event, term: string) => {
    const settings = getSettings()
    if (!settings.workspacePath) return []
    return await searchInFiles(settings.workspacePath, term)
  })
  ipcMain.handle('plugins:list', () => getAvailablePlugins())
  ipcMain.handle('plugins:enable', async (_event, id: string) => enablePlugin(id))
  ipcMain.handle('plugins:disable', async (_event, id: string) => disablePlugin(id))
  ipcMain.handle('plugins:remove', async (_event, id: string) => removePlugin(id))
  ipcMain.handle('workspace:getLibrary', () => getWorkspaceLibrary())
  ipcMain.handle('workspace:updateCollections', async (_event, path: string, collections: string[]) => {
    return updateWorkspaceCollections(path, collections)
  })
  ipcMain.handle('workspace:getRelations', (_event, path: string) => getWorkspaceRelations(path))
  ipcMain.handle('workspace:importBibTeX', (_event, content: string) => {
    const settings = getSettings()
    if (!settings.workspacePath) {
      return Promise.resolve({ style: 'ABNT', importedAt: null, entries: [] })
    }
    return importBibTeX(settings.workspacePath, content)
  })
  ipcMain.handle('workspace:setBibliographyStyle', (_event, style) => {
    const settings = getSettings()
    if (!settings.workspacePath) {
      return Promise.resolve({ style: 'ABNT', importedAt: null, entries: [] })
    }
    return setBibliographyStyle(settings.workspacePath, style)
  })

  ipcMain.handle('versions:list', (_event, path: string) => listVersions(path))
  ipcMain.handle('versions:text', (_event, path: string, file: string) => getVersionText(path, file))

  ipcMain.handle('fontProfiles:save', (_event, profile: Omit<FontProfile, 'id'>) => saveFontProfile(profile))
  ipcMain.handle('fontProfiles:delete', (_event, id: string) => deleteFontProfile(id))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_event, partial) => {
    const updated = setSettings(partial)
    setupAutosave() // Atualiza o timer se necessário
    if (partial.syncPath !== undefined) setupSyncWatcher(notifySyncChange)
    buildMenu()
    return updated
  })
  ipcMain.handle('app:info', () => APP_INFO)
  ipcMain.handle('fonts:list', () => listSystemFonts())
  ipcMain.handle('file:selectDirectory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.on('document:dirty', (_event, dirty: boolean) => {
    documentDirty = dirty
  })
}

app.whenReady().then(() => {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception in Main Process:', err)
  })
  
  registerIpc()
  createSplash()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

app.on('before-quit', () => {
  unloadPlugins()
  stopSyncWatcher()
})
