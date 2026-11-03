import { serve } from '@hono/node-server'
import { buildContainer } from './di/container.js'

// Node.js のエントリポイント。環境変数が不正なら buildContainer が例外で起動を止める。
// 起動時に SQLite の表を作る（CREATE TABLE IF NOT EXISTS）。
const { app, env, logger } = await buildContainer(process.env)

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandledRejection', { reason: String(reason) })
})
process.on('uncaughtException', (error) => {
  logger.error('process.uncaughtException', { error: { name: error.name, message: error.message } })
  process.exit(1)
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info('server.listening', { port: info.port })
})
