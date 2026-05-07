import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { getMe, type Player } from './api.js';
import NamePicker from './NamePicker.js';

type Phase = 'loading' | 'name-picker' | 'connecting' | 'connected';

export default function PlayerApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [player, setPlayer] = useState<Player | null>(null);

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

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  function handleJoined(p: Player) {
    setPlayer(p);
    setPhase('connecting');
    socket.connect();
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Virtual Tabletop</h1>
      {phase === 'loading' && <p>Loading&hellip;</p>}
      {phase === 'name-picker' && <NamePicker onJoined={handleJoined} />}
      {phase === 'connecting' && <p>Connecting{player ? ` as ${player.name}` : ''}&hellip;</p>}
      {phase === 'connected' && (
        <p>
          Hi, <strong style={{ color: player?.color }}>{player?.name ?? 'DM'}</strong>!
        </p>
      )}
    </main>
  );
}
