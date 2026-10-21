import nextConfig from 'eslint-config-next';

export default [
  ...nextConfig,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
      'scripts/**',
    ],
  },
];
