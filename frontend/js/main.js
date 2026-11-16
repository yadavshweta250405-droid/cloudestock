import { startApp } from './app.js';

window.addEventListener('unhandledrejection', (e) => console.error('Unhandled promise rejection:', e.reason));
startApp(document.getElementById('app'));
