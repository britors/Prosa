// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ProsaApi } from '../shared/types.js'

declare global {
  interface Window {
    /** API do Prosa exposta pelo preload via contextBridge. */
    prosa: ProsaApi
  }
}

export {}
