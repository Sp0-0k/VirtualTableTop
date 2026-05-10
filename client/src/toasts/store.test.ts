import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useToasts } from './store.js';

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('push returns a fresh id and adds the toast', () => {
    const id = useToasts.getState().push('hello', 'info');
    const ts = useToasts.getState().toasts;
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ id, message: 'hello', level: 'info' });
  });

  it('non-sticky toasts auto-expire after 4 seconds', () => {
    useToasts.getState().push('bye', 'error');
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('sticky toasts do not auto-expire', () => {
    useToasts.getState().push('stay', 'info', { sticky: true });
    vi.advanceTimersByTime(60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('push with a provided id replaces any existing toast with that id', () => {
    useToasts.getState().push('first', 'info', { id: 'fixed' });
    useToasts.getState().push('second', 'info', { id: 'fixed' });
    const ts = useToasts.getState().toasts;
    expect(ts).toHaveLength(1);
    expect(ts[0].message).toBe('second');
  });

  it('dismiss removes the toast by id', () => {
    const id = useToasts.getState().push('hi', 'info', { sticky: true });
    useToasts.getState().dismiss(id);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });
});
