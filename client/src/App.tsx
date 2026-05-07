import DmApp from './DmApp.js';
import PlayerApp from './PlayerApp.js';

function isDmPath(): boolean {
  return window.location.pathname.startsWith('/dm');
}

export default function App() {
  return isDmPath() ? <DmApp /> : <PlayerApp />;
}
