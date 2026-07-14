import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { installTabFocusVisibility } from './components/ui/focus';
import App from './App.tsx';

installTabFocusVisibility(document);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
