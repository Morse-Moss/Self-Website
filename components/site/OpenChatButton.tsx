'use client';

import type { ReactNode } from 'react';

type OpenChatButtonProps = {
  children: ReactNode;
  className?: string;
  prompt?: string;
};

export default function OpenChatButton({
  children,
  className,
  prompt,
}: OpenChatButtonProps) {
  return (
    <button
      className={className}
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('morse-chat:open', {
        detail: { prompt },
      }))}
    >
      {children}
    </button>
  );
}
