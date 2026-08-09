import coreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.worktrees/**',
      'auto-job-agent/**',
      'boss-helper-main/**',
      'get_jobs/**',
      'get_jobs-git-incomplete/**',
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
