import { usePlayerStore } from '../stores/playerStore.js';

export default function PlayerCanvas() {
  const activePage = usePlayerStore((s) => s.activePage);

  return (
    <div
      style={{
        flex: 1,
        background: '#111',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {activePage?.background_url ? (
        <img
          src={activePage.background_url}
          alt={activePage.name}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : (
        <p style={{ color: '#888' }}>Waiting for the DM…</p>
      )}
    </div>
  );
}
