import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ServerNotice } from './ServerNotice.tsx'
import { LanguageProvider } from './i18n/LanguageContext'
import { startBackgroundMusic } from './audio/bgm'

// Under every screen, for the life of the tab — see audio/bgm.ts.
startBackgroundMusic()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ServerNotice />
      <App />
    </LanguageProvider>
  </StrictMode>,
)
