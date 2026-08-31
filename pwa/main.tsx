import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRoot } from '@/components/app/app-root';
import '@/assets/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot router="hash" />
  </React.StrictMode>,
);

// The service worker is emitted only by the production build (see
// vite.pwa.config.ts), so registration is skipped in dev rather than 404ing.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(
      new URL('./sw.js', import.meta.url),
      { scope: './' },
    );
  });
}
