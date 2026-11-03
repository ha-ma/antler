import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './app/global.css'
import { installGlobalErrorHandlers } from './shared/utils/logger'

installGlobalErrorHandlers()

const root = document.getElementById('root')
if (!root) {
  throw new Error('#root が index.html にありません')
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
