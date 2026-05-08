import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineWorkspace([
  {
    test: {
      name: 'server',
      include: ['tests/**/*.test.ts'],
      environment: 'node',
      setupFiles: ['./tests/setup.ts'],
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'client',
      include: ['client/src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./client/test-setup.ts'],
    },
  },
]);
