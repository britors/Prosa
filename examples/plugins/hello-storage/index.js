const { createPlugin } = require('./sdk')

const plugin = createPlugin()

async function main() {
  plugin.log('hello-storage carregado')

  const current = await plugin.storage.get('saudacao')
  if (!current) {
    await plugin.storage.set('saudacao', 'oi')
  }

  plugin.log(`saudacao atual: ${current ?? 'vazia'}`)
  plugin.send({ type: 'log', message: 'plugin de exemplo executado com sucesso' })
}

main().catch((error) => {
  plugin.log(error instanceof Error ? error.message : String(error), 'error')
})
