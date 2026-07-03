// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const watch = process.argv.includes('--watch')

const banner = {
  js: '/* Prosa — © 2026 Rodrigo Brito — GPL-3.0-or-later */'
}

/** Build configuration for the Electron main process (Node target). */
const mainConfig = {
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/main/index.js',
  external: ['electron', 'electron-store', 'electron-updater', 'font-list'],
  sourcemap: true,
  banner
}

/** Build configuration for the Electron preload script (Node target). */
const preloadConfig = {
  entryPoints: ['src/main/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/main/preload.js',
  external: ['electron'],
  sourcemap: true,
  banner
}

/** Build configuration for the renderer (browser target). */
const rendererConfig = {
  entryPoints: ['src/renderer/index.ts'],
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'iife',
  outfile: 'dist/renderer/index.js',
  sourcemap: true,
  loader: { '.css': 'css' },
  banner
}

/** Copies static assets (HTML, CSS, imagens) into the dist folder. */
function copyStatic() {
  mkdirSync('dist/renderer/assets', { recursive: true })
  cpSync('src/renderer/index.html', 'dist/renderer/index.html')
  cpSync('src/renderer/splash.html', 'dist/renderer/splash.html')
  cpSync('src/renderer/styles.css', 'dist/renderer/styles.css')
  
  // Copia recursiva de assets, incluindo ícones
  cpSync('src/renderer/assets', 'dist/renderer/assets', { recursive: true })

  // Ícone usado pela janela em runtime.
  cpSync('build/icon.png', join('dist', 'icon.png'))

  // KaTeX (CSS + fontes) para renderização de fórmulas matemáticas offline.
  mkdirSync('dist/renderer/vendor/katex/fonts', { recursive: true })
  cpSync('node_modules/katex/dist/katex.min.css', 'dist/renderer/vendor/katex/katex.min.css')
  cpSync('node_modules/katex/dist/fonts', 'dist/renderer/vendor/katex/fonts', { recursive: true })
}

async function run() {
  if (watch) {
    const ctxMain = await esbuild.context(mainConfig)
    const ctxPreload = await esbuild.context(preloadConfig)
    const ctxRenderer = await esbuild.context(rendererConfig)
    copyStatic()
    await Promise.all([ctxMain.watch(), ctxPreload.watch(), ctxRenderer.watch()])
    console.log('Prosa: observando alterações...')
  } else {
    await Promise.all([
      esbuild.build(mainConfig),
      esbuild.build(preloadConfig),
      esbuild.build(rendererConfig)
    ])
    copyStatic()
    console.log('Prosa: build concluído.')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
