import { useEffect, useMemo, useState } from 'react';
import { socket } from './socket.js';
import {
  bootstrapDm,
  listMapAssets,
  listTokenAssets,
  listPages,
  listTokens,
  createToken,
  type ApiAsset,
} from './api.js';
import { useDmStore } from './stores/dmStore.js';
import { attachDmListeners } from './socketListeners.js';
import { Canvas } from './canvas/Canvas.js';
import PagesSidebar from './dm/PagesSidebar.js';
import MapsLibrary from './dm/MapsLibrary.js';
import NewPageModal from './dm/NewPageModal.js';
import { TokenLibrary } from './dm/TokenLibrary.js';
import { TokenPopover } from './dm/TokenPopover.js';
import { PageSettingsPanel } from './dm/PageSettingsPanel.js';

type Phase = 'bootstrapping' | 'connecting' | 'connected' | 'error';

export default function DmApp() {
  const [phase, setPhase] = useState<Phase>('bootstrapping');
  const [error, setError] = useState<string | null>(null);
  const [showNewPage, setShowNewPage] = useState(false);

  useEffect(() => {
    let cancelled = false;

    bootstrapDm()
      .then(async () => {
        if (cancelled) return;
        setPhase('connecting');
        const [mapAssets, tokenAssets, pages] = await Promise.all([
          listMapAssets(),
          listTokenAssets(),
          listPages(),
        ]);
        if (cancelled) return;
        useDmStore.getState().setAssets([...mapAssets, ...tokenAssets]);
        useDmStore.getState().setPages(pages);
        socket.connect();
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setPhase('error');
      });

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('connecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const detach = attachDmListeners(socket, {
      onFullSync: (p) => {
        useDmStore.getState().setPlayers(p.players);
        useDmStore.getState().setTokens(p.tokens);
      },
      onActivePageChanged: ({ activePage }) => {
        useDmStore.getState().setActivePageId(activePage?.id ?? null);
        if (activePage) {
          listTokens(activePage.id).then((ts) => useDmStore.getState().setTokens(ts));
        } else {
          useDmStore.getState().setTokens([]);
        }
      },
      onPageCreated: ({ page }) => useDmStore.getState().upsertPage(page),
      onPageUpdated: ({ page }) => useDmStore.getState().upsertPage(page),
      onPageDeleted: ({ id }) => useDmStore.getState().removePage(id),
      onAssetCreated: (payload) => {
        if ('asset' in payload && payload.asset) {
          useDmStore.getState().upsertAsset(payload.asset as ApiAsset);
        }
      },
      onAssetDeleted: ({ id }) => {
        const next = useDmStore.getState().assets.filter((a) => a.id !== id);
        useDmStore.getState().setAssets(next);
      },
      onTokenCreated: (t) => useDmStore.getState().upsertToken(t),
      onTokenUpdated: (t) => useDmStore.getState().upsertToken(t),
      onTokenDeleted: ({ id }) => useDmStore.getState().removeToken(id),
      onTokenMoving: ({ id, x, y }) => useDmStore.getState().setIncomingMove(id, { x, y }),
      onTokenMoved: ({ id, x, y }) => {
        const t = useDmStore.getState().tokens[id];
        if (t) useDmStore.getState().upsertToken({ ...t, x, y });
        useDmStore.getState().clearIncomingMove(id);
        useDmStore.getState().clearDragging(id);
      },
    });

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      detach();
    };
  }, []);

  const previewPage = useDmStore((s) =>
    s.selectedPageId ? s.pages.find((p) => p.id === s.selectedPageId) ?? null : null,
  );
  const tokens = useDmStore((s) => Object.values(s.tokens));
  const players = useDmStore((s) => s.players);
  const selectedTokenId = useDmStore((s) => s.selectedTokenId);
  const dragging = useDmStore((s) => s.dragging);
  const incomingMove = useDmStore((s) => s.incomingMove);
  const movableTokenIds = useMemo(() => new Set(tokens.map((t) => t.id)), [tokens]);
  const selectedToken = tokens.find((t) => t.id === selectedTokenId) ?? null;

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
      <aside style={{ borderRight: '1px solid #333', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <PagesSidebar onNewPage={() => setShowNewPage(true)} />
        <MapsLibrary />
        <TokenLibrary />
        <PageSettingsPanel />
      </aside>
      <main style={{ position: 'relative' }}>
        {previewPage ? (
          <Canvas
            page={previewPage}
            tokens={tokens}
            players={players}
            movableTokenIds={movableTokenIds}
            selectable
            selectedTokenId={selectedTokenId}
            dragging={dragging}
            incomingMove={incomingMove}
            onSelect={(id) => useDmStore.getState().selectToken(id)}
            onDropAsset={(assetId, world) => {
              createToken({
                page_id: previewPage.id, asset_id: assetId, x: world.x, y: world.y,
              }).then((t) => useDmStore.getState().upsertToken(t));
            }}
            onMovePreview={(id, x, y) => {
              useDmStore.getState().setDragging(id, { x, y });
              socket.emit('token:move_preview', { id, x, y });
            }}
            onMoveCommit={(id, x, y) => {
              useDmStore.getState().setDragging(id, { x, y });
              socket.emit('token:move_commit', { id, x, y });
            }}
          />
        ) : (
          <div style={{ padding: 24, color: '#888' }}>Select a page from the sidebar</div>
        )}
        {selectedToken && (
          <div style={{ position: 'absolute', top: 16, right: 16 }}>
            <TokenPopover
              token={selectedToken}
              players={players}
              onClose={() => useDmStore.getState().selectToken(null)}
            />
          </div>
        )}
      </main>
      {showNewPage && <NewPageModal onClose={() => setShowNewPage(false)} />}
    </div>
  );
}
