import { createHash } from 'node:crypto';

export interface InviteState {
  active: boolean;
  expiresAt: Date;
  sessionCount: number;
  maxSessions: number;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function isInviteUsable(invite: InviteState, now = new Date()): boolean {
  return (
    invite.active
    && invite.expiresAt.getTime() > now.getTime()
    && invite.sessionCount < invite.maxSessions
  );
}
