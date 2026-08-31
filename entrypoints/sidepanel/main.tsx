import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRoot } from '@/components/app/app-root';
import '@/assets/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot router="memory" />
  </React.StrictMode>,
);
