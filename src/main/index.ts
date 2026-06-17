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
import chokidar from 'chokidar'
import { exportPdf, openDocument, saveDocument } from './file-manager.js'
import {
  getRecentFiles,
  getSettings,
  setSettings,
  clearRecentFiles,
  getPinnedFiles,
  pinFile,
  unpinFile
} from './settings.js'
import { getAvailableTemplates, getTemplateContent, saveTemplate, deleteTemplate } from './templates.js'
import { PluginManager } from './plugins.js'
import { initUpdater } from './updater.js'
import { listSystemFonts } from './fonts.js'
import { attachSpellCheckContextMenu, configureSpellChecker } from './spellcheck.js'
import type { AppInfo, SavePayload } from '../shared/types.js'

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
/** Observador de arquivos da pasta de sincronização. */
let syncWatcher: chokidar.FSWatcher | null = null
/** Indica se o documento atual possui alterações não salvas. */
let documentDirty = false

/** Gerencia o timer de autosave com base nas configurações atuais. */
function setupAutosave(): void {
  if (autosaveTimer) clearInterval(autosaveTimer)
  autosaveTimer = null

  const settings = getSettings()
  if (settings.autoSave && settings.autoSaveInterval > 0) {
    autosaveTimer = setInterval(() => {
      if (documentDirty && mainWindow) {
        // Solicita o conteúdo atual ao renderer para salvar
        mainWindow.webContents.send('menu:action', 'file:autoSave')
      }
    }, settings.autoSaveInterval * 60 * 1000)
  }
}

/** Inicializa o monitoramento da pasta de sincronização. */
function setupSyncWatcher(): void {
  if (syncWatcher) void syncWatcher.close()
  syncWatcher = null

  const settings = getSettings()
  if (settings.syncPath) {
    syncWatcher = chokidar.watch(settings.syncPath, {
      ignored: /(^|[/\\])\../, // ignore dotfiles
      persistent: true
    })

    syncWatcher.on('change', (path) => {
        mainWindow?.webContents.send('menu:action', 'sync:fileChanged', path)
    })
  }
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
  setupSyncWatcher()
  
  // Inicializa o gerenciador de plugins
  void PluginManager.getInstance().loadPlugins()
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
        { type: 'separator' },
        {
          label: 'Exportar PDF',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendMenuAction('file:exportPdf')
        },
        {
          label: 'Imprimir...',
          accelerator: 'CmdOrCtrl+P',
          click: () => handlePrint()
        },
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
        { label: 'Alternar contagem de palavras', click: () => sendMenuAction('view:toggleWordCount') },
        {
          label: 'Verificar ortografia',
          type: 'checkbox',
          checked: getSettings().spellcheck,
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
      buildMenu()
    }
    return result
  })

  ipcMain.handle('file:saveAs', async (_event, payload: SavePayload) => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    const result = await saveDocument(mainWindow, payload, true)
    if (result.ok) {
      documentDirty = false
      buildMenu()
    }
    return result
  })

  ipcMain.handle('file:exportPdf', async (_event, defaultName: string) => {
    if (!mainWindow) return { ok: false, error: 'Janela indisponível' }
    return exportPdf(mainWindow, defaultName)
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
  ipcMain.handle('file:pin', (_event, file: RecentFile) => pinFile(file))
  ipcMain.handle('file:unpin', (_event, path: string) => unpinFile(path))
  ipcMain.handle('file:search', async (_event, term: string) => {
    const settings = getSettings()
    if (!settings.workspacePath) return []
    return await searchInFiles(settings.workspacePath, term)
  })
  ipcMain.handle('plugins:list', () => PluginManager.getInstance().getAvailablePlugins())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_event, partial) => {
    const updated = setSettings(partial)
    setupAutosave() // Atualiza o timer se necessário
    if (partial.syncPath !== undefined) setupSyncWatcher()
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
