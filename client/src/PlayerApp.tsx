import { useEffect, useMemo, useState } from 'react';
import { socket } from './socket.js';
import { getMe, type Player } from './api.js';
import NamePicker from './NamePicker.js';
import { Canvas } from './canvas/Canvas.js';
import { usePlayerStore } from './stores/playerStore.js';
import { attachPlayerListeners } from './socketListeners.js';

type Phase = 'loading' | 'name-picker' | 'connecting' | 'connected';

export default function PlayerApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [player, setPlayer] = useState<Player | null>(null);

  const activePage = usePlayerStore((s) => s.activePage);
  const tokensRecord = usePlayerStore((s) => s.tokens);
  const tokens = useMemo(() => Object.values(tokensRecord), [tokensRecord]);
  const players = usePlayerStore((s) => s.players);
  const dragging = usePlayerStore((s) => s.dragging);
  const incomingMove = usePlayerStore((s) => s.incomingMove);
  const fogStrokes = usePlayerStore((s) => s.activePageStrokes);

  const movableTokenIds = useMemo(
    () =>
      player
        ? new Set(tokens.filter((t) => t.owner_player_id === player.id).map((t) => t.id))
        : new Set<number>(),
    [tokens, player],
  );

  useEffect(() => {
    if (player) usePlayerStore.getState().setMyPlayerId(player.id);
  }, [player]);

  useEffect(() => {
    getMe()
      .then((me) => {
        if (me.role === 'player') {
          setPlayer(me.player);
          setPhase('connecting');
          socket.connect();
        } else if (me.role === 'dm') {
          setPhase('connecting');
          socket.connect();
        } else {
          setPhase('name-picker');
        }
      })
      .catch(() => setPhase('name-picker'));

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('connecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const detach = attachPlayerListeners(socket, {
      onFullSync: (p) => {
        usePlayerStore.getState().setActivePage(p.activePage);
        usePlayerStore.getState().setPlayers(p.players);
        usePlayerStore.getState().setTokens(p.tokens);
        usePlayerStore.getState().setActivePageStrokes(p.activePage?.strokes ?? []);
        usePlayerStore.getState().setOnlinePlayerIds(p.online_player_ids);
      },
      onActivePageChanged: ({ activePage }) => {
        usePlayerStore.getState().setActivePage(activePage);
        usePlayerStore.getState().setActivePageStrokes(activePage?.strokes ?? []);
      },
      onTokenCreated: (t) => usePlayerStore.getState().upsertToken(t),
      onTokenUpdated: (t) => usePlayerStore.getState().upsertToken(t),
      onTokenDeleted: ({ id }) => usePlayerStore.getState().removeToken(id),
      onTokenMoving: ({ id, x, y }) =>
        usePlayerStore.getState().setIncomingMove(id, { x, y }),
      onTokenMoved: ({ id, x, y }) => {
        const t = usePlayerStore.getState().tokens[id];
        if (t) usePlayerStore.getState().upsertToken({ ...t, x, y });
        usePlayerStore.getState().clearIncomingMove(id);
        usePlayerStore.getState().clearDragging(id);
      },
      onFogStrokeAdded: ({ stroke }) => {
        usePlayerStore.getState().appendActivePageStroke(stroke);
      },
      onFogCleared: () => {
        usePlayerStore.getState().clearActivePageStrokes();
      },
      onPlayerJoined: ({ playerId }) => usePlayerStore.getState().markPlayerOnline(playerId),
      onPlayerLeft: ({ playerId }) => usePlayerStore.getState().markPlayerOffline(playerId),
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      detach();
    };
  }, []);

  function handleJoined(p: Player) {
    setPlayer(p);
    setPhase('connecting');
    socket.connect();
  }

  if (phase === 'name-picker') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>Virtual Tabletop</h1>
        <NamePicker onJoined={handleJoined} />
      </main>
    );
  }

  const otherPlayers = player
    ? players.filter((p) => p.id !== player.id)
    : [];

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <strong>VTT</strong>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>
          {phase === 'connected' ? 'connected' : 'connecting…'}
        </span>
        {player && (
          <span style={{ marginLeft: 'auto' }}>
            Hi, <strong style={{ color: player.color }}>{player.name}</strong>
            {' — '}
            {otherPlayers.length > 0
              ? otherPlayers.map((p) => p.name).join(', ')
              : 'you are alone'}
          </span>
        )}
      </header>
      <main style={{ flex: 1, position: 'relative' }}>
        {activePage ? (
          <Canvas
            page={activePage}
            tokens={tokens}
            players={players}
            movableTokenIds={movableTokenIds}
            selectable={false}
            selectedTokenId={null}
            dragging={dragging}
            incomingMove={incomingMove}
            role="player"
            fogStrokes={fogStrokes}
            fogInProgress={null}
            onMovePreview={(id, x, y) => {
              usePlayerStore.getState().setDragging(id, { x, y });
              socket.emit('token:move_preview', { id, x, y });
            }}
            onMoveCommit={(id, x, y) => {
              usePlayerStore.getState().setDragging(id, { x, y });
              socket.emit('token:move_commit', { id, x, y });
            }}
          />
        ) : (
          <div style={{ padding: 24, color: '#888' }}>
            {phase === 'connected' ? 'Waiting for the DM…' : 'Connecting…'}
          </div>
        )}
      </main>
    </div>
  );
}
