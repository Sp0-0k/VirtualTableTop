import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { getMe, type Player, type ApiPage } from './api.js';
import NamePicker from './NamePicker.js';
import PlayerCanvas from './player/PlayerCanvas.js';
import { usePlayerStore } from './stores/playerStore.js';

type Phase = 'loading' | 'name-picker' | 'connecting' | 'connected';

export default function PlayerApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [player, setPlayer] = useState<Player | null>(null);
  const setActivePage = usePlayerStore((s) => s.setActivePage);

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
    const onFullSync = (payload: { activePage: ApiPage | null }) => {
      setActivePage(payload.activePage);
    };
    const onActiveChanged = (payload: { activePage: ApiPage | null }) => {
      setActivePage(payload.activePage);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state:full_sync', onFullSync);
    socket.on('state:active_page_changed', onActiveChanged);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state:full_sync', onFullSync);
      socket.off('state:active_page_changed', onActiveChanged);
    };
  }, [setActivePage]);

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
          </span>
        )}
      </header>
      <PlayerCanvas />
    </div>
  );
}
