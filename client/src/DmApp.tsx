import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { bootstrapDm } from './api.js';

type Phase = 'bootstrapping' | 'connecting' | 'connected' | 'error';

export default function DmApp() {
  const [phase, setPhase] = useState<Phase>('bootstrapping');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    bootstrapDm()
      .then(() => {
        if (cancelled) return;
        setPhase('connecting');
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

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Virtual Tabletop — DM</h1>
      {phase === 'bootstrapping' && <p>Authenticating&hellip;</p>}
      {phase === 'connecting' && <p>Connecting&hellip;</p>}
      {phase === 'connected' && <p>Role: <strong>DM</strong></p>}
      {phase === 'error' && <p style={{ color: 'crimson' }}>Error: {error}</p>}
    </main>
  );
}
