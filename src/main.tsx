import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { exposeDebugHandle } from './debug';
import './index.css';

// Before the render, so anything the first mount logs is already reachable.
exposeDebugHandle(window as unknown as Record<string, unknown>);

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
