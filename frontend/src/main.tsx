import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/atlas-shell.css'
import App from './App'
import { initRuntimeConfig } from './config/runtime'
import { readEnv } from './config/env'

async function start() {
  await initRuntimeConfig()

  if (readEnv('VITE_ENABLE_MOCKS', 'false') === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  const root = document.getElementById('root')
  if (!root) throw new Error('Root element not found')

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

start()
