import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ServerNotice } from './ServerNotice.tsx'
import { LanguageProvider } from './i18n/LanguageContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ServerNotice />
      <App />
    </LanguageProvider>
  </StrictMode>,
)
