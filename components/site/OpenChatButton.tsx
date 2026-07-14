'use client';

import type { ReactNode } from 'react';

type OpenChatButtonProps = {
  children: ReactNode;
  className?: string;
};

export default function OpenChatButton({
  children,
  className,
}: OpenChatButtonProps) {
  return (
    <button
      className={className}
      type="button"
      onClick={() => window.dispatchEvent(new Event('morse-chat:open'))}
    >
      {children}
    </button>
  );
}
