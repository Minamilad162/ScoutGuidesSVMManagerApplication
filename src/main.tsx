import { ToastProvider } from './components/ui/Toaster'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import faviconUrl from './assets/Scout-SVM.png'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
)

function setFavicon(url: string) {
  let fav = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav); }
  fav.type = 'image/png';
  fav.href = url;

  let apple = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
  if (!apple) { apple = document.createElement('link'); apple.rel = 'apple-touch-icon'; document.head.appendChild(apple); }
  apple.href = url;
}

setFavicon(faviconUrl);

// Register SW (مرة واحدة)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}
