const { existsSync } = require('node:fs')
const { readFile, stat } = require('node:fs/promises')
const { createPlugin } = require('./sdk')

const plugin = createPlugin()
const STORAGE_KEY = 'zotero-sync:bibtex-path'

async function importSelectedFile(filePath) {
  const raw = await readFile(filePath, 'utf-8')
  const state = await plugin.importBibTeX(raw)
  plugin.log(`Bibliografia importada: ${state.entries.length} entrada(s)`)
  await plugin.storage.set(STORAGE_KEY, filePath)
}

async function bootstrap() {
  plugin.log('Zotero Sync carregado')

  const storedPath = await plugin.storage.get(STORAGE_KEY)
  if (typeof storedPath === 'string' && storedPath && existsSync(storedPath)) {
    const stats = await stat(storedPath)
    plugin.log(`Reimportando ${storedPath} (${stats.size} bytes)`)
    await importSelectedFile(storedPath)
    return
  }

  const chosen = await plugin.chooseBibTeXFile('Selecionar exportação BibTeX do Zotero')
  if (!chosen) {
    plugin.log('Nenhum arquivo selecionado; o plugin ficará ocioso até a próxima execução.')
    return
  }

  await importSelectedFile(chosen)
}

bootstrap().catch((error) => {
  plugin.log(error instanceof Error ? error.message : String(error), 'error')
})
