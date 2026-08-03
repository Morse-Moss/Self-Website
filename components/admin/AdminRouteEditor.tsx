'use client';

import { useMemo, useState } from 'react';

import type { RouteTargetInput } from './admin-api-client';
import { preserveLockedRouteIndices } from './provider-ui-state';
import styles from './AdminApiConsole.module.css';

export interface RouteCandidate {
  configDigest: string;
  identity: string;
  key: string;
  label: string;
  meta: string;
  target: RouteTargetInput;
  testLabel: string;
  locked?: boolean;
  unavailable?: boolean;
}

interface Props {
  candidates: RouteCandidate[];
  currentKeys: string[];
  initialKeys?: string[] | null;
  open: boolean;
  onActivate: (targets: RouteTargetInput[]) => void;
  onClose: () => void;
}

const positionLabels = ['主线路', '备用 1', '备用 2', '备用 3', '备用 4', '备用 5'];

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function AdminRouteEditor({ candidates, currentKeys, initialKeys, open, onActivate, onClose }: Props) {
  const [keys, setKeys] = useState<string[]>(initialKeys ?? currentKeys);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const byKey = useMemo(() => new Map(candidates.map((candidate) => [candidate.key, candidate])), [candidates]);
  const selected = keys.map((key) => byKey.get(key)).filter((item): item is RouteCandidate => Boolean(item));
  const selectedIdentities = new Set(selected.map((candidate) => candidate.identity));
  const available = candidates.filter((candidate) => !keys.includes(candidate.key)
    && !selectedIdentities.has(candidate.identity) && !candidate.unavailable && !candidate.locked);
  const changed = keys.join('|') !== currentKeys.join('|');
  const lockedKeys = useMemo(() => new Set(candidates.filter((candidate) => candidate.locked).map((candidate) => candidate.key)), [candidates]);

  function mutate(next: (current: string[]) => string[]) {
    setKeys((current) => preserveLockedRouteIndices(currentKeys, next(current), lockedKeys));
  }

  if (!open) return null;

  return (
    <div className={styles.layerBackdrop}>
      <section className={styles.routeLayer} role="dialog" aria-modal="true" aria-labelledby="route-editor-title">
        <header className={styles.layerHeader}>
          <button type="button" className={styles.backButton} onClick={onClose}>← 返回</button>
          <div>
            <p className={styles.eyebrow}>GLOBAL CHAT ROUTE</p>
            <h2 id="route-editor-title">编辑路由</h2>
          </div>
        </header>

        <div className={styles.routeEditorBody}>
          <section className={styles.routeDraft} aria-labelledby="route-draft-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>ORDERED TARGETS</p>
                <h3 id="route-draft-title">一主五备</h3>
              </div>
              <span>{selected.length} / 6</span>
            </div>
            {selected.length === 0 ? (
              <p className={styles.emptyState}>至少加入一条可用线路。</p>
            ) : (
              <ol className={styles.routeList}>
                {selected.map((candidate, index) => (
                  <li
                    key={candidate.key}
                    draggable={!candidate.locked}
                    onDragStart={() => { if (!candidate.locked) setDragIndex(index); }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== index) mutate((current) => move(current, dragIndex, index));
                      setDragIndex(null);
                    }}
                  >
                    <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
                    <span className={styles.routePosition}>{positionLabels[index]}</span>
                    <span className={styles.routeIdentity}>
                      <strong>{candidate.label}</strong>
                      <small>{candidate.meta}{candidate.locked ? ' · 当前环境源已锁定' : ''}</small>
                    </span>
                    <span className={styles.testState}>{candidate.testLabel}</span>
                    <span className={styles.routeControls}>
                      <button
                        type="button"
                        aria-label={`上移 ${candidate.label}`}
                        title={`上移 ${candidate.label}`}
                        disabled={candidate.locked || index === 0}
                        onClick={() => mutate((current) => move(current, index, index - 1))}
                      >↑</button>
                      <button
                        type="button"
                        aria-label={`下移 ${candidate.label}`}
                        title={`下移 ${candidate.label}`}
                        disabled={candidate.locked || index === selected.length - 1}
                        onClick={() => mutate((current) => move(current, index, index + 1))}
                      >↓</button>
                      <button
                        type="button"
                        aria-label={`移除 ${candidate.label}`}
                        title={`移除 ${candidate.label}`}
                        disabled={candidate.locked}
                        onClick={() => mutate((current) => current.filter((key) => key !== candidate.key))}
                      >×</button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={styles.candidatePanel} aria-labelledby="route-candidates-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>AVAILABLE</p>
                <h3 id="route-candidates-title">可加入线路</h3>
              </div>
            </div>
            {available.length === 0 ? <p className={styles.emptyState}>没有更多可用线路。</p> : (
              <ul className={styles.candidateList}>
                {available.map((candidate) => (
                  <li key={candidate.key}>
                    <span>
                      <strong>{candidate.label}</strong>
                      <small>{candidate.meta} · {candidate.testLabel}</small>
                    </span>
                    <button
                      type="button"
                      data-testid={`route-candidate-${candidate.identity}`}
                      disabled={selected.length >= 6}
                      onClick={() => mutate((current) => [...current, candidate.key])}
                    >加入</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.diffPanel} aria-labelledby="route-diff-title">
            <p className={styles.eyebrow}>REVIEW</p>
            <h3 id="route-diff-title">配置差异</h3>
            <p>{changed ? `线路顺序或成员有变化，将从 ${currentKeys.length} 条更新为 ${keys.length} 条。` : '当前草稿与活动路由一致。'}</p>
          </section>
        </div>

        <footer className={styles.stickyActions}>
          <button type="button" className={styles.quietButton} disabled={!changed} onClick={() => setKeys(currentKeys)}>
            放弃更改
          </button>
          <button
            type="button"
            data-testid="route-activate"
            className={styles.primaryButton}
            disabled={!changed || selected.length === 0 || selected.length > 6}
            onClick={() => onActivate(selected.map((candidate) => candidate.target))}
          >
            激活配置
          </button>
        </footer>
      </section>
    </div>
  );
}
