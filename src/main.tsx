import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { reduxStore } from './stores/reduxStore'
import './index.css'
import App from './App.tsx'

// Initialize theme on boot (applies 'dark' class to <html> if needed)
import './stores/useThemeStore'
import { installRearmNet } from './utils/order-alert'

// Layer 1 safety net (GUIDE.md §3): re-arm audio on the vendor's next
// interaction if arming ever fails, plus on tab visibility changes.
installRearmNet()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={reduxStore}>
    <App />
    </Provider>
  </StrictMode>,
)
