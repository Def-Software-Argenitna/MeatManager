import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import { LicenseProvider } from './context/LicenseContext'
import './index.css'
import App from './App.jsx'

console.log('App starting...');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <LicenseProvider>
          <App />
        </LicenseProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
