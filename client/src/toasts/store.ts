import { create } from 'zustand';

export type ToastLevel = 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  level: ToastLevel;
  sticky?: boolean;
}

interface PushOpts {
  sticky?: boolean;
  id?: string;
}

interface ToastsState {
  toasts: Toast[];
  push: (message: string, level?: ToastLevel, opts?: PushOpts) => string;
  dismiss: (id: string) => void;
}

const AUTO_EXPIRE_MS = 4000;

let _counter = 0;
function nextId(): string {
  _counter += 1;
  return `t-${_counter}`;
}

export const useToasts = create<ToastsState>((set, get) => ({
  toasts: [],
  push: (message, level = 'info', opts = {}) => {
    const id = opts.id ?? nextId();
    set((s) => ({
      toasts: [
        ...s.toasts.filter((t) => t.id !== id),
        { id, message, level, sticky: opts.sticky },
      ],
    }));
    if (!opts.sticky) {
      setTimeout(() => {
        const exists = get().toasts.find((t) => t.id === id);
        if (exists && !exists.sticky) get().dismiss(id);
      }, AUTO_EXPIRE_MS);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
