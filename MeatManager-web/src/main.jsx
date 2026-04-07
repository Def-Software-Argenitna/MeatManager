import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import App from './App.jsx'

console.log('App starting...');

function showAppUpdateOverlay() {
  if (document.getElementById('app-update-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'app-update-overlay';
  overlay.className = 'app-update-overlay';
  overlay.innerHTML = `
    <div class="app-update-card">
      <div class="app-update-spinner" aria-hidden="true"></div>
      <p class="app-update-title">Actualizando aplicacion</p>
      <p class="app-update-text">Instalando la ultima version. Espera un momento.</p>
    </div>
  `;

  document.body.appendChild(overlay);
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    showAppUpdateOverlay()
    window.setTimeout(() => {
      updateSW(true)
    }, 350)
  },
  onOfflineReady() {
    console.log('PWA offline cache ready')
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
