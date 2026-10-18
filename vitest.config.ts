import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    test: {
      environment: 'node',
      globals: true,
      fileParallelism: false,
      env: {
        ...env,
        DATABASE_URL: env.DATABASE_URL || 'postgresql://findit:findit@localhost:5432/findit?schema=public',
        AUTH_SECRET: env.AUTH_SECRET || 'pY8uX2wM5nK4rQ7zD1aC9bV3eT6yU8iO0lJ2gH4fS6A=',
      },
      server: {
        deps: {
          inline: ['next-auth', '@auth/core'],
        },
      },
    },
    ssr: {
      noExternal: ['next-auth', '@auth/core'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
        'next/server': path.resolve(__dirname, './node_modules/next/server.js'),
      },
    },
  };
});
