import type { FormEvent, RefObject } from 'react';

import styles from '../MorseChat.module.css';

export default function JdIntake({
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
    <form className={styles.intake} data-testid="morse-jd-intake" onSubmit={submit}>
      <div className={styles.intakeHeading}>
        <label htmlFor="morse-jd">职位描述</label>
        <span>{value.length.toLocaleString('zh-CN')} / 12,000</span>
      </div>
      <textarea
        ref={inputRef}
        id="morse-jd"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="粘贴完整 JD"
        maxLength={12_000}
        rows={5}
        disabled={streaming}
      />
      <button
        type={streaming ? 'button' : 'submit'}
        onClick={streaming ? onStop : undefined}
        disabled={!streaming && !value.trim()}
        data-action={streaming ? 'stop' : 'send'}
      >
        {streaming ? '停止' : '分析 JD'}
      </button>
    </form>
  );
}
