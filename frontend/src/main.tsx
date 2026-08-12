import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CartProvider } from './store/cart'
import { AuthProvider } from './store/auth'
import { ProfileProvider } from './store/profile'
import { ToastProvider } from './store/toast'
import { ThemeProvider } from './store/theme'
import { FavoritosProvider } from './store/favoritos'
import { OnboardingProvider } from './store/onboarding'
import './index.css'
import App from './App.tsx'

if (typeof window !== 'undefined') {
  const shouldSuppress = (source: unknown): boolean => {
    const text = String(source || '')
    return (
      text.includes('content_script.js') ||
      text.includes('background.js') ||
      text.includes('contentScript.bundle.js') ||
      text.includes('chrome-extension')
    )
  }
  window.addEventListener('error', e => {
    const src = e.filename || e.error?.stack || ''
    if (shouldSuppress(src)) e.preventDefault()
  })
  window.addEventListener('unhandledrejection', e => {
    const src = (e.reason && (e.reason.stack || e.reason)) || ''
    if (shouldSuppress(src)) e.preventDefault()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ProfileProvider>
            <OnboardingProvider>
              <CartProvider>
                <FavoritosProvider>
                  <ToastProvider>
                    <App />
                  </ToastProvider>
                </FavoritosProvider>
              </CartProvider>
            </OnboardingProvider>
          </ProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
