import { useDmStore } from '../stores/dmStore.js';

export default function DmCanvas() {
  const selectedPageId = useDmStore((s) => s.selectedPageId);
  const page = useDmStore((s) => s.pages.find((p) => p.id === selectedPageId) ?? null);

  return (
    <div
      style={{
        flex: 1,
        background: '#222',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {page?.background_url ? (
        <img
          src={page.background_url}
          alt={page.name}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : (
        <p style={{ color: '#888' }}>
          {page ? 'No background.' : 'Select or create a page.'}
        </p>
      )}
    </div>
  );
}
