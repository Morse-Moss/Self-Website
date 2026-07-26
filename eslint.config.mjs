import coreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.worktrees/**',
      'out/**',
      'output/**',
      'tmp/**',
      'docs/**',
      'prototype/**',
      'next-env.d.ts',
    ],
  },
  ...coreWebVitals,
];

export default eslintConfig;
