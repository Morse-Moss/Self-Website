import type { FormEvent, RefObject } from 'react';

import type { DiagnosisFields, DiagnosisUiStatus } from '@/lib/contracts/chat';

import styles from '../MorseChat.module.css';

const fields: Array<{
  name: keyof DiagnosisFields;
  label: string;
  placeholder: string;
}> = [
  { name: 'problem', label: '问题', placeholder: '现在最需要解决的问题' },
  { name: 'goal', label: '目标', placeholder: '希望达成的结果' },
  { name: 'currentState', label: '当前状态', placeholder: '已有系统、资源或进展' },
  { name: 'constraints', label: '约束', placeholder: '时间、预算、合规或技术限制' },
  { name: 'expectedTimeline', label: '预期时间', placeholder: '期望启动或完成时间' },
];

export default function DiagnosisIntake({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  status,
  inputRef,
}: {
  value: DiagnosisFields;
  onChange(value: DiagnosisFields): void;
  onSubmit(): void;
  onStop(): void;
  streaming: boolean;
  status: DiagnosisUiStatus;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const completedFields = fields.filter((field) => value[field.name].trim()).length;
  const handedOff = status === 'handoff_pending';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!streaming && !handedOff) onSubmit();
  }

  return (
    <form
      className={styles.diagnosisIntake}
      data-testid="morse-diagnosis-intake"
      onSubmit={submit}
    >
      <div className={styles.intakeHeading}>
        <span>需求信息</span>
        <span>{completedFields} / 5</span>
      </div>
      <div className={styles.diagnosisFields}>
        {fields.map((field, index) => (
          <label key={field.name} className={styles.diagnosisField}>
            <span>{field.label}</span>
            <textarea
              ref={index === 0 ? inputRef : undefined}
              name={field.name}
              value={value[field.name]}
              onChange={(event) => onChange({ ...value, [field.name]: event.target.value })}
              placeholder={field.placeholder}
              rows={2}
              disabled={streaming || handedOff}
            />
          </label>
        ))}
      </div>
      <button
        type={streaming ? 'button' : 'submit'}
        onClick={streaming ? onStop : undefined}
        disabled={!streaming && (completedFields === 0 || handedOff)}
        data-action={streaming ? 'stop' : 'send'}
      >
        {streaming ? '停止' : handedOff ? '已进入转交队列' : '提交初诊'}
      </button>
    </form>
  );
}
