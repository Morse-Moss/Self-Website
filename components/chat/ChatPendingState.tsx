'use client';

import { useEffect, useState } from 'react';

import type { ChatPhase } from '@/lib/contracts/chat';

import { chatPhaseLabel } from './ChatPhaseStatus';
import styles from '../MorseChat.module.css';

export default function ChatPendingState({
  startedAtMs,
  phase,
  onStop,
}: {
  startedAtMs: number;
  phase?: ChatPhase | null;
  onStop(): void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => (
    Math.max(0, Math.floor((Date.now() - startedAtMs) / 1_000))
  ));

  useEffect(() => {
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1_000)));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [startedAtMs]);

  const phaseText = phase ? chatPhaseLabel(phase) : '正在处理你的问题';

  return (
    <div className={styles.pendingState} data-testid="morse-chat-pending">
      <div className={styles.pendingTrack} role="progressbar" aria-label="回答处理中">
        <span className={styles.pendingBar} />
      </div>
      <div className={styles.pendingMeta}>
        <span>{phaseText}</span>
        {elapsedSeconds >= 8 ? <span>已等待 {elapsedSeconds} 秒</span> : null}
        <button type="button" data-action="stop" onClick={onStop}>停止</button>
      </div>
      {elapsedSeconds >= 30 ? (
        <p className={styles.pendingNotice}>仍在处理中，你可以继续等待或停止。</p>
      ) : null}
    </div>
  );
}
