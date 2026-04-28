import { useEffect, useState } from 'react';
import { socket } from './socket.js';

type Status = 'connecting' | 'connected' | 'disconnected';

export default function App() {
  const [status, setStatus] = useState<Status>(socket.connected ? 'connected' : 'connecting');
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onHello = (msg: { greeting: string }) => setGreeting(msg.greeting);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('hello', onHello);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('hello', onHello);
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Virtual Tabletop</h1>
      <p>
        Socket: <strong>{status}</strong>
        {greeting && <> — server says &ldquo;{greeting}&rdquo;</>}
      </p>
    </main>
  );
}
