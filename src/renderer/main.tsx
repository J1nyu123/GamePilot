import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { createWebGamepilot } from './web-adapter';

if (typeof window.gamepilot === 'undefined') {
  window.gamepilot = createWebGamepilot();
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
