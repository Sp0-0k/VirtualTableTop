import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { bootstrapDm, listMapAssets, listPages, type ApiAsset, type ApiPage } from './api.js';
import { useDmStore } from './stores/dmStore.js';
import PagesSidebar from './dm/PagesSidebar.js';
import MapsLibrary from './dm/MapsLibrary.js';
import NewPageModal from './dm/NewPageModal.js';
import DmCanvas from './dm/DmCanvas.js';

type Phase = 'bootstrapping' | 'connecting' | 'connected' | 'error';

export default function DmApp() {
  const [phase, setPhase] = useState<Phase>('bootstrapping');
  const [error, setError] = useState<string | null>(null);
  const [showNewPage, setShowNewPage] = useState(false);

  const setAssets = useDmStore((s) => s.setAssets);
  const upsertAsset = useDmStore((s) => s.upsertAsset);
  const setPages = useDmStore((s) => s.setPages);
  const upsertPage = useDmStore((s) => s.upsertPage);
  const removePage = useDmStore((s) => s.removePage);
  const setActivePageId = useDmStore((s) => s.setActivePageId);

  useEffect(() => {
    let cancelled = false;

    bootstrapDm()
      .then(async () => {
        if (cancelled) return;
        setPhase('connecting');
        socket.connect();
        const [assets, pages] = await Promise.all([listMapAssets(), listPages()]);
        if (cancelled) return;
        setAssets(assets);
        setPages(pages);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setPhase('error');
      });

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('connecting');
    const onAssetCreated = (payload: { asset: ApiAsset }) => upsertAsset(payload.asset);
    const onPageCreated = (payload: { page: ApiPage }) => upsertPage(payload.page);
    const onPageUpdated = (payload: { page: ApiPage }) => upsertPage(payload.page);
    const onPageDeleted = (payload: { id: number }) => removePage(payload.id);
    const onActiveChanged = (payload: { activePage: ApiPage | null }) => {
      setActivePageId(payload.activePage?.id ?? null);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('asset:created', onAssetCreated);
    socket.on('page:created', onPageCreated);
    socket.on('page:updated', onPageUpdated);
    socket.on('page:deleted', onPageDeleted);
    socket.on('state:active_page_changed', onActiveChanged);

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('asset:created', onAssetCreated);
      socket.off('page:created', onPageCreated);
      socket.off('page:updated', onPageUpdated);
      socket.off('page:deleted', onPageDeleted);
      socket.off('state:active_page_changed', onActiveChanged);
    };
  }, [setAssets, upsertAsset, setPages, upsertPage, removePage, setActivePageId]);

  if (phase === 'error') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>Virtual Tabletop — DM</h1>
        <p style={{ color: 'crimson' }}>Error: {error}</p>
      </main>
    );
  }

  if (phase === 'bootstrapping') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p>Authenticating…</p>
      </main>
    );
  }

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        height: '100vh',
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        gridTemplateRows: 'auto 1fr',
      }}
    >
      <header
        style={{
          gridColumn: '1 / 3',
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <strong>VTT — DM</strong>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>
          {phase === 'connected' ? 'connected' : 'connecting…'}
        </span>
      </header>
      <aside style={{ borderRight: '1px solid #ddd', overflowY: 'auto' }}>
        <PagesSidebar onNewPage={() => setShowNewPage(true)} />
        <MapsLibrary />
      </aside>
      <DmCanvas />
      {showNewPage && <NewPageModal onClose={() => setShowNewPage(false)} />}
    </div>
  );
}
