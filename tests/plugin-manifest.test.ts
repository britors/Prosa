// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validatePluginManifest } from '../src/main/plugin-manifest.ts'

function makePluginDir(id: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'prosa-plugin-'))
  const pluginDir = join(dir, id)
  mkdirSync(pluginDir, { recursive: true })
  return pluginDir
}

function writeEntry(pluginDir: string, name = 'index.js'): void {
  writeFileSync(join(pluginDir, name), '// plugin de teste\n')
}

test('aceita um manifesto válido completo', () => {
  const pluginDir = makePluginDir('hello-world')
  writeEntry(pluginDir)
  const result = validatePluginManifest(
    {
      id: 'hello-world',
      name: 'Hello World',
      version: '1.0.0',
      entrypoint: 'index.js',
      permissions: ['storage']
    },
    pluginDir,
    'hello-world'
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.manifest.id, 'hello-world')
    assert.equal(result.manifest.name, 'Hello World')
    assert.deepEqual(result.manifest.permissions, ['storage'])
  }
})

test('normaliza permissions ausente para lista vazia', () => {
  const pluginDir = makePluginDir('sem-permissoes')
  writeEntry(pluginDir)
  const result = validatePluginManifest(
    { id: 'sem-permissoes', name: 'Sem Permissões', version: '1.0.0', entrypoint: 'index.js' },
    pluginDir,
    'sem-permissoes'
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.manifest.permissions, [])
})

test('rejeita manifesto sem name', () => {
  const pluginDir = makePluginDir('sem-nome')
  writeEntry(pluginDir)
  const result = validatePluginManifest(
    { id: 'sem-nome', name: '', version: '1.0.0', entrypoint: 'index.js' },
    pluginDir,
    'sem-nome'
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('"name"')))
})

test('rejeita version mal formatada', () => {
  const pluginDir = makePluginDir('versao-invalida')
  writeEntry(pluginDir)
  const result = validatePluginManifest(
    { id: 'versao-invalida', name: 'Versão Inválida', version: 'abc', entrypoint: 'index.js' },
    pluginDir,
    'versao-invalida'
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('"version"')))
})

test('rejeita entrypoint ausente', () => {
  const pluginDir = makePluginDir('sem-entrypoint')
  const result = validatePluginManifest(
    { id: 'sem-entrypoint', name: 'Sem Entrypoint', version: '1.0.0', entrypoint: '' },
    pluginDir,
    'sem-entrypoint'
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('"entrypoint"')))
})

test('rejeita permissão desconhecida nomeando o valor', () => {
  const pluginDir = makePluginDir('permissao-desconhecida')
  writeEntry(pluginDir)
  const result = validatePluginManifest(
    {
      id: 'permissao-desconhecida',
      name: 'Permissão Desconhecida',
      version: '1.0.0',
      entrypoint: 'index.js',
      permissions: ['nuclear-launch']
    },
    pluginDir,
    'permissao-desconhecida'
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('nuclear-launch')))
})

test('rejeita entrypoint que tenta escapar da pasta do plugin', () => {
  const pluginDir = makePluginDir('traversal')
  const result = validatePluginManifest(
    { id: 'traversal', name: 'Traversal', version: '1.0.0', entrypoint: '../../evil.js' },
    pluginDir,
    'traversal'
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('fora da pasta')))
})

test('rejeita entrypoint que aponta para arquivo inexistente', () => {
  const pluginDir = makePluginDir('arquivo-inexistente')
  const result = validatePluginManifest(
    { id: 'arquivo-inexistente', name: 'Arquivo Inexistente', version: '1.0.0', entrypoint: 'nao-existe.js' },
    pluginDir,
    'arquivo-inexistente'
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('não existe em disco')))
})

test('rejeita id do manifesto diferente do nome da pasta', () => {
  const pluginDir = makePluginDir('pasta-real')
  writeEntry(pluginDir)
  const result = validatePluginManifest(
    { id: 'outro-id', name: 'Outro Id', version: '1.0.0', entrypoint: 'index.js' },
    pluginDir,
    'pasta-real'
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('outro-id') && e.includes('pasta-real')))
})

test('o plugin de exemplo oficial tem manifesto válido', () => {
  const pluginDir = resolve('examples/plugins/hello-storage')
  const raw = JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf-8'))
  const result = validatePluginManifest(raw, pluginDir, 'hello-storage')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.manifest.id, 'hello-storage')
    assert.deepEqual(result.manifest.permissions, ['storage'])
  }
})

test('o plugin oficial de Zotero tem manifesto válido', () => {
  const pluginDir = resolve('examples/plugins/zotero-sync')
  const raw = JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf-8'))
  const result = validatePluginManifest(raw, pluginDir, 'zotero-sync')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.manifest.id, 'zotero-sync')
    assert.deepEqual(result.manifest.permissions, ['dialog', 'storage', 'workspace'])
  }
})
