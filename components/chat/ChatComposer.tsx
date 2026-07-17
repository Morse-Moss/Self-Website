import type { FormEvent, RefObject } from 'react';

import styles from '../MorseChat.module.css';

export default function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  inputRef,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onStop(): void;
  streaming: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!streaming) onSubmit();
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <label className={styles.srOnly} htmlFor="morse-message">输入问题</label>
      <textarea
        ref={inputRef}
        id="morse-message"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="问项目、经历或技术决策"
        maxLength={2_000}
        rows={2}
        disabled={streaming}
      />
      <button
        type={streaming ? 'button' : 'submit'}
        onClick={streaming ? onStop : undefined}
        disabled={!streaming && !value.trim()}
        data-action={streaming ? 'stop' : 'send'}
      >
        {streaming ? '停止' : '发送'}
      </button>
    </form>
  );
}
