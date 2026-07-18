import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['app', 'components', 'lib'];
const sourceExtensions = new Set(['.ts', '.tsx']);
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

function toRepositoryPath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

async function collectSourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(toRepositoryPath(entryPath));
    }
  }
  return files;
}

function importCandidates(importer, specifier) {
  let unresolved;
  if (specifier.startsWith('@/')) {
    unresolved = specifier.slice(2);
  } else if (specifier.startsWith('.')) {
    unresolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  } else {
    return [];
  }

  const extension = path.posix.extname(unresolved);
  if (sourceExtensions.has(extension)) return [unresolved];
  if (extension === '.js' || extension === '.jsx') {
    const withoutExtension = unresolved.slice(0, -extension.length);
    return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`];
  }
  if (extension) return [];
  return [
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}/index.ts`,
    `${unresolved}/index.tsx`,
  ];
}

function resolveInternalImport(importer, specifier, sourceFiles) {
  return importCandidates(importer, specifier).find((candidate) => sourceFiles.has(candidate)) ?? null;
}

async function buildGraph() {
  const discovered = (
    await Promise.all(sourceRoots.map((root) => collectSourceFiles(path.join(repositoryRoot, root))))
  ).flat().sort();
  const sourceFiles = new Set(discovered);
  const graph = new Map();
  const imports = new Map();

  for (const file of discovered) {
    const source = await fs.readFile(path.join(repositoryRoot, ...file.split('/')), 'utf8');
    const specifiers = ts.preProcessFile(source, true, true).importedFiles
      .map((entry) => entry.fileName);
    const resolved = specifiers
      .map((specifier) => resolveInternalImport(file, specifier, sourceFiles))
      .filter((target) => target !== null)
      .sort();
    graph.set(file, [...new Set(resolved)]);
    imports.set(file, specifiers.map((specifier) => ({
      specifier,
      target: resolveInternalImport(file, specifier, sourceFiles),
    })));
  }

  return { graph, imports };
}

function canonicalCycle(cycle) {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_, index) => {
    const rotated = [...nodes.slice(index), ...nodes.slice(0, index)];
    return [...rotated, rotated[0]];
  });
  return rotations.sort((left, right) => left.join('\0').localeCompare(right.join('\0')))[0];
}

function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const stackIndexes = new Map();
  const cycles = new Map();

  function visit(node) {
    state.set(node, 'visiting');
    stackIndexes.set(node, stack.length);
    stack.push(node);

    for (const target of graph.get(node) ?? []) {
      if (!state.has(target)) {
        visit(target);
      } else if (state.get(target) === 'visiting') {
        const cycle = canonicalCycle([
          ...stack.slice(stackIndexes.get(target)),
          target,
        ]);
        cycles.set(cycle.join(' -> '), cycle);
      }
    }

    stack.pop();
    stackIndexes.delete(node);
    state.set(node, 'visited');
  }

  for (const node of [...graph.keys()].sort()) {
    if (!state.has(node)) visit(node);
  }
  return [...cycles.values()].sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
}

function hasPrefix(file, prefix) {
  return file === prefix.slice(0, -1) || file.startsWith(prefix);
}

function findBoundaryViolations(imports) {
  const violations = [];
  const boundaryRules = [
    { source: 'components/', forbidden: ['lib/server/', 'app/'] },
    { source: 'lib/client/', forbidden: ['lib/server/', 'app/', 'components/'] },
    { source: 'lib/server/', forbidden: ['app/', 'components/'] },
    { source: 'app/api/', forbidden: ['components/'] },
  ];

  for (const [source, sourceImports] of imports) {
    for (const imported of sourceImports) {
      for (const rule of boundaryRules) {
        if (
          hasPrefix(source, rule.source)
          && imported.target
          && rule.forbidden.some((prefix) => hasPrefix(imported.target, prefix))
        ) {
          violations.push(`${source} -> ${imported.target}`);
        }
      }

      if (hasPrefix(source, 'lib/client/') && !imported.target) {
        const packageRoot = imported.specifier.split('/')[0];
        if (
          nodeBuiltins.has(imported.specifier)
          || packageRoot === 'pg'
          || packageRoot === 'openai'
        ) {
          violations.push(`${source} -> ${imported.specifier}`);
        }
      }

      if (hasPrefix(source, 'lib/contracts/')) {
        if (!imported.target || !hasPrefix(imported.target, 'lib/contracts/')) {
          violations.push(`${source} -> ${imported.target ?? imported.specifier}`);
        }
      }
    }
  }

  return [...new Set(violations)].sort();
}

test('production TypeScript dependency graph is acyclic', async () => {
  const { graph } = await buildGraph();
  const cycles = findCycles(graph);
  assert.deepEqual(
    cycles,
    [],
    `dependency cycles:\n${cycles.map((cycle) => cycle.join(' -> ')).join('\n')}`,
  );
});

test('production TypeScript modules respect layer boundaries', async () => {
  const { imports } = await buildGraph();
  const violations = findBoundaryViolations(imports);
  assert.deepEqual(
    violations,
    [],
    `layer boundary violations:\n${violations.join('\n')}`,
  );
});
