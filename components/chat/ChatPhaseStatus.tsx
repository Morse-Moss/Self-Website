import type { ChatPhase, DiagnosisStatus } from './useMorseChat';

import styles from '../MorseChat.module.css';

const phaseLabels: Record<ChatPhase, string> = {
  routing: '正在判断问题路径',
  knowledge: '正在检索公开知识',
  web: '正在判断是否需要联网',
  answering: '正在组织回答',
  handoff: '已进入转交队列',
};

export default function ChatPhaseStatus({
  phase,
  diagnosisStatus,
}: {
  phase: ChatPhase | null;
  diagnosisStatus: DiagnosisStatus;
}) {
  const visiblePhase: ChatPhase | null = phase
    ?? (diagnosisStatus === 'handoff_pending' ? 'handoff' : null);
  const label = visiblePhase ? phaseLabels[visiblePhase] : '';

  return (
    <div
      className={styles.phaseStatus}
      data-testid="morse-chat-phase"
      data-phase={visiblePhase ?? undefined}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {label ? <><span className={styles.phaseSignal} aria-hidden="true" />{label}</> : null}
    </div>
  );
}
