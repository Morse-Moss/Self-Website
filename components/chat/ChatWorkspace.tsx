import type { RefObject, UIEvent } from 'react';

import ChatComposer from './ChatComposer';
import ChatPhaseStatus from './ChatPhaseStatus';
import ChatTranscript from './ChatTranscript';
import DiagnosisIntake from './DiagnosisIntake';
import JdIntake from './JdIntake';
import type { MorseChatController } from './useMorseChat';

import styles from '../MorseChat.module.css';

const starterIntents = [
  {
    label: '招聘',
    mode: 'interviewer' as const,
    audienceIntent: 'recruiter' as const,
    prompt: '请从招聘方视角介绍最匹配的项目、能力证据和仍需补充的信息。',
  },
  {
    label: '合作',
    mode: 'general' as const,
    audienceIntent: 'collaboration' as const,
    prompt: '我想了解摩斯会如何分析并推进一个 AI 系统需求。',
  },
  {
    label: '同行交流',
    mode: 'general' as const,
    audienceIntent: 'peer' as const,
    prompt: '请介绍摩斯在 Agent、RAG 和多 Agent 系统上的关键工程判断。',
  },
];

export default function ChatWorkspace({
  chat,
  inputRef,
  messagesRef,
  onMessagesScroll,
}: {
  chat: MorseChatController;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  messagesRef: RefObject<HTMLDivElement | null>;
  onMessagesScroll(event: UIEvent<HTMLDivElement>): void;
}) {
  const empty = chat.workflow === 'chat' ? (
    <>
      <p>想先了解哪一部分?</p>
      <div className={styles.starters}>
        {starterIntents.map((intent) => (
          <button
            key={intent.label}
            type="button"
            data-starter-intent={intent.audienceIntent}
            onClick={() => chat.sendStarter(intent)}
          >
            {intent.label}
          </button>
        ))}
      </div>
    </>
  ) : (
    <p>{chat.workflow === 'jd_match' ? '提交 JD 后，这里会生成证据化匹配报告。' : '提交需求信息后，这里会生成初诊摘要。'}</p>
  );

  return (
    <div className={styles.workspace} data-testid="morse-chat-workspace">
      <div className={styles.controlBar}>
        <div className={styles.workflowSwitch} aria-label="对话流程">
          <button
            type="button"
            data-workflow="chat"
            aria-pressed={chat.workflow === 'chat'}
            disabled={chat.streaming}
            onClick={() => chat.setWorkflow('chat')}
          >
            自由对话
          </button>
          <button
            type="button"
            data-workflow="jd_match"
            aria-pressed={chat.workflow === 'jd_match'}
            disabled={chat.streaming}
            onClick={() => chat.setWorkflow('jd_match')}
          >
            JD 匹配
          </button>
          <button
            type="button"
            data-workflow="diagnosis"
            aria-pressed={chat.workflow === 'diagnosis'}
            disabled={chat.streaming}
            onClick={() => chat.setWorkflow('diagnosis')}
          >
            需求初诊
          </button>
        </div>
        <span className={styles.quota} data-testid="morse-quota">{chat.remainingMessages} 次</span>
      </div>

      <ChatPhaseStatus phase={chat.phase} diagnosisStatus={chat.diagnosisStatus} />
      {chat.historyError ? <p className={styles.workspaceNotice} role="alert">{chat.historyError}</p> : null}

      <ChatTranscript
        messages={chat.messages}
        messagesRef={messagesRef}
        onScroll={onMessagesScroll}
        onRetry={(assistantId, snapshot) => chat.retry(assistantId, snapshot)}
        streaming={chat.streaming}
        empty={empty}
      />

      {chat.workflow === 'chat' ? (
        <ChatComposer
          value={chat.draft}
          onChange={chat.setDraft}
          onSubmit={chat.sendCurrent}
          onStop={chat.stop}
          streaming={chat.streaming}
          inputRef={inputRef}
        />
      ) : chat.workflow === 'jd_match' ? (
        <JdIntake
          value={chat.jobDescription}
          onChange={chat.setJobDescription}
          onSubmit={chat.sendCurrent}
          onStop={chat.stop}
          streaming={chat.streaming}
          inputRef={inputRef}
        />
      ) : (
        <DiagnosisIntake
          value={chat.diagnosis}
          onChange={chat.setDiagnosis}
          onSubmit={chat.sendCurrent}
          onStop={chat.stop}
          streaming={chat.streaming}
          status={chat.diagnosisStatus}
          inputRef={inputRef}
        />
      )}

      <footer className={styles.sessionFooter}>
        <span>{chat.expiresAt ? `有效至 ${new Date(chat.expiresAt).toLocaleString('zh-CN')}` : '短期会话'}</span>
        <button type="button" onClick={() => void chat.logout()}>退出会话</button>
      </footer>
    </div>
  );
}
