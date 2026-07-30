import type {
  ChatAudienceIntent,
  ChatEvidenceClass,
  ChatMode,
  ChatRouteKind,
  ChatTopicKind,
  ChatWorkflow,
  DiagnosisFields,
  DiagnosisStatus,
} from './chat.ts';

export type SafetyBoundaryReason = 'unsafe_or_unverifiable_request';

export interface NormalizedChatRequest {
  message: string;
  workflow?: ChatWorkflow;
  jobDescription?: string | null;
  diagnosis?: DiagnosisFields | null;
  diagnosisStatus?: Extract<DiagnosisStatus, 'collecting' | 'complete'> | null;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
  conversationId: string | null;
  turnId: string | null;
}

export interface ChatRouteDecision {
  routeKind: ChatRouteKind;
  reasonCode: string;
  topicKind: ChatTopicKind;
  topicRef: string | null;
  evidenceClass: ChatEvidenceClass;
  inheritedFromTurnId: string | null;
  release: 'segment' | 'complete';
  requiresEmbedding: boolean;
  requiresSearch: boolean;
  safetyBoundary: SafetyBoundaryReason | null;
}

export interface KnowledgeSource {
  chunkId: string;
  documentId: string;
  title: string;
  sourcePath: string;
  href: string;
  content: string;
  score: number;
  projectSlug?: string | null;
  topicIds?: string[];
  evidenceLevel?: 'direct' | 'transferable';
}
