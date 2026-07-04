// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

function createPlugin() {
  const port = process.parentPort
  if (!port) {
    throw new Error('process.parentPort indisponível no processo do plugin.')
  }

  let nextRequestId = 1
  const pending = new Map()

  port.on('message', (message) => {
    if (!message || typeof message !== 'object' || typeof message.requestId !== 'string') {
      return
    }
    const entry = pending.get(message.requestId)
    if (!entry) return
    pending.delete(message.requestId)

    if (message.type === 'error') {
      entry.reject(new Error(String(message.message ?? 'Erro do processo principal.')))
      return
    }

    entry.resolve(message.value)
  })

  function request(type, payload) {
    const requestId = String(nextRequestId++)
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject })
      port.postMessage({ type, requestId, ...payload })
    })
  }

  return {
    log(message, level = 'info') {
      port.postMessage({ type: 'log', level, message })
    },
    storage: {
      get: (key) => request('storage:get', { key }),
      set: (key, value) => request('storage:set', { key, value })
    },
    onMessage(listener) {
      port.on('message', listener)
      return () => {
        if (typeof port.off === 'function') {
          port.off('message', listener)
        }
      }
    },
    send(message) {
      port.postMessage(message)
    }
  }
}

module.exports = { createPlugin }
