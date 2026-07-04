<div align="center">

# Plugins do Prosa

### Isolamento por padrão, permissões explícitas.

</div>

---

## Introdução

O Prosa carrega plugins de forma isolada: cada plugin instalado roda em seu próprio
processo do sistema operacional (via `utilityProcess` do Electron), sem referência à
janela principal, ao editor ou ao sistema de arquivos além do que for explicitamente
concedido. Um plugin não tem acesso a nada por padrão — cada capacidade precisa ser
declarada no manifesto e é verificada pelo processo principal a cada chamada.

## Formato do plugin

Cada plugin vive em sua própria pasta dentro do diretório de dados do usuário:

```
<userData>/plugins/<id>/
  manifest.json
  index.js         (ou o entrypoint declarado no manifesto)
```

### Schema de `manifest.json`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :---: | --- |
| `id` | string | sim | Apenas `a-z`, `0-9` e `-`. Precisa ser idêntico ao nome da pasta. |
| `name` | string | sim | Nome de exibição. |
| `version` | string | sim | Versão no formato semver (ex: `1.0.0`). |
| `entrypoint` | string | sim | Caminho relativo (terminando em `.js`) para o arquivo executado no processo isolado. Precisa resolver para dentro da própria pasta do plugin. |
| `permissions` | string[] | não | Lista de permissões solicitadas (ver tabela abaixo). Padrão: nenhuma. |
| `description` | string | não | Descrição curta, exibida no diálogo de plugins. |
| `author` | string | não | Autor do plugin. |

Manifestos inválidos (campo ausente, `entrypoint` fora da pasta, permissão
desconhecida, `id` que não bate com a pasta etc.) são rejeitados com uma mensagem de
erro específica, o plugin aparece como "Falha" no diálogo de plugins, e **o restante do
aplicativo continua funcionando normalmente** — um plugin quebrado nunca impede o Prosa
de iniciar.

## SDK oficial

O contrato mínimo recomendado para plugins fica em torno de uma única porta de
mensagens, exposta pelo processo isolado:

- `process.parentPort.postMessage(message)` para enviar mensagens ao Prosa.
- `process.parentPort.on('message', handler)` para receber respostas do processo
  principal.

Mensagens conhecidas na v1:

- `{ type: 'log', level?: 'info' | 'warn' | 'error', message: string }`
- `{ type: 'storage:get', requestId: string, key: string }`
- `{ type: 'storage:set', requestId: string, key: string, value: unknown }`
- `{ type: 'dialog:openFile', requestId: string, title?: string, extensions?: string[] }`
- `{ type: 'workspace:importBibTeX', requestId: string, content: string }`
- `{ type: 'storage:result', requestId: string, value: unknown }`
- `{ type: 'dialog:result', requestId: string, value: string | null }`
- `{ type: 'workspace:result', requestId: string, value: unknown }`
- `{ type: 'error', requestId?: string, message: string }`

Para reduzir boilerplate e padronizar o handshake, o repositório inclui um helper
copiável em `examples/plugins/hello-storage/sdk.js`. Ele embrulha o canal bruto e
oferece:

- `log(message, level?)`
- `storage.get(key)`
- `storage.set(key, value)`
- `onMessage(listener)`
- `send(message)`

Esse helper é a referência oficial do contrato mínimo. APIs além dessas mensagens
devem ser consideradas instáveis até aparecerem nesta documentação.

## Permissões (v1)

O conjunto de permissões é deliberadamente mínimo: cada uma só existe quando já há
código no processo principal que a aplica de verdade.

| Permissão | Concede |
| --- | --- |
| `storage` | Acesso a um armazenamento chave-valor próprio do plugin (`storage:get`/`storage:set`), persistido em `<userData>/plugins-data/<id>/store.json`. Sem essa permissão, toda requisição de `storage` é recusada e registrada como tentativa negada. |
| `dialog` | Permite pedir ao processo principal que abra um seletor de arquivo (`dialog:openFile`). Útil para importar arquivos locais sem acoplar o plugin ao DOM do renderer. |
| `workspace` | Permite importar BibTeX para a bibliografia do workspace atual (`workspace:importBibTeX`). Sem essa permissão, o plugin não consegue atualizar a base bibliográfica do editor. |

Novas permissões só serão adicionadas junto com a funcionalidade que elas de fato
protegem — nunca de forma especulativa.

## Modelo de isolamento

- Cada plugin é iniciado com `utilityProcess.fork()`: um processo do SO separado do
  processo principal do Electron e da janela do editor.
- O plugin **não recebe** referência a `BrowserWindow`, `app`, ao DOM do renderer ou a
  qualquer objeto interno do Prosa.
- Toda comunicação acontece por um conjunto fixo e pequeno de mensagens trocadas via
  `process.parentPort.postMessage()` (do lado do plugin) e `postMessage()`/`on('message')`
  (do lado do processo principal) — não é o mesmo canal de IPC usado entre o processo
  principal e a interface do editor.
- Cada capacidade (hoje, só `storage`) é conferida contra as permissões declaradas no
  manifesto antes de ser executada.
- `stdout`/`stderr` do plugin são espelhados no log do processo principal com o prefixo
  `[plugin:<id>]`, e o encerramento inesperado do processo marca o plugin como "Falha"
  sem afetar os demais plugins nem o restante do aplicativo.

## Escrevendo um plugin — exemplo mínimo

O exemplo funcional de referência fica em `examples/plugins/hello-storage/`. Copie a
pasta inteira para `<userData>/plugins/hello-storage/` para carregá-la no Prosa.
O plugin oficial de integração com Zotero fica em `examples/plugins/zotero-sync/` e
mostra o fluxo de importação local de um `BibTeX` exportado.

`manifest.json`:

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "entrypoint": "index.js",
  "permissions": ["storage"]
}
```

`sdk.js`:

```js
function createPlugin() {
  const port = process.parentPort
  if (!port) throw new Error('process.parentPort indisponível.')

  let nextRequestId = 1
  const pending = new Map()

  port.on('message', (message) => {
    if (message && typeof message === 'object' && typeof message.requestId === 'string') {
      const entry = pending.get(message.requestId)
      if (!entry) return
      pending.delete(message.requestId)
      if (message.type === 'error') {
        entry.reject(new Error(message.message))
      } else {
        entry.resolve(message.value)
      }
    }
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
      return () => port.off?.('message', listener)
    },
    send(message) {
      port.postMessage(message)
    }
  }
}

module.exports = { createPlugin }
```

`index.js`:

```js
const { createPlugin } = require('./sdk')

const plugin = createPlugin()

async function main() {
  plugin.log('olá do plugin!')
  const current = await plugin.storage.get('saudacao')
  if (!current) {
    await plugin.storage.set('saudacao', 'oi')
  }
  plugin.send({ type: 'log', message: `valor atual: ${current ?? 'vazio'}` })
}

main().catch((error) => {
  plugin.log(error.message, 'error')
})
```

## Diagnóstico

- `[plugins] <id>: carregado (vX.Y.Z, permissões: ...)` — plugin carregado com sucesso.
- `[plugins] <id>: manifesto inválido — ...` / `[plugins] <id>: manifest.json inválido (...)` — falha de validação, com a lista de problemas encontrados.
- `[plugins] <id>: processo encerrado (código N)` — o processo do plugin caiu.
- `[plugin:<id>] ...` — saída de `console.log`/`console.error` do próprio plugin.

O diálogo "Gerenciar Plugins" (acessível pela paleta de comandos, `Ctrl+K`) mostra o
mesmo estado — nome, versão, permissões declaradas e, em caso de falha, a mensagem de
erro.

## Limitações conhecidas / roadmap

- Apenas a permissão `storage` tem enforcement real nesta versão — é uma prova do
  pipeline completo (manifesto → permissão → processo isolado → IPC controlado →
  aplicação da permissão), não um conjunto completo de capacidades. Futuras permissões
  (acesso ao editor, rede, clipboard etc.) chegarão junto com o código que as impõe.
- `utilityProcess` isola o plugin do processo principal e da janela do editor, mas o
  processo do plugin continua sendo um processo Node comum: ele tem acesso normal ao
  `fs`/`net`/`child_process` do próprio sistema operacional dentro do seu processo. O
  modelo de permissões do Node (`--permission`, `--allow-fs-read`, etc.) poderia
  restringir isso também, mas ainda é experimental na versão de Node empacotada pelo
  Electron e fica de fora desta versão — é um candidato natural para uma issue de
  follow-up, não algo que quisemos arriscar junto com o restante da base de sandbox.
- Não há tratamento especial para symlinks dentro da pasta do plugin em v1.
