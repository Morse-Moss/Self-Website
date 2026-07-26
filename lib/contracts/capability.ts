import type { ProjectSlug } from './site-content.ts';

export interface CapabilityPolicyEntry {
  id: string;
  label: string;
  aliases: string[];
  projectSlugs?: ProjectSlug[];
}

export interface CapabilityTransferRule {
  target: string;
  from: string[];
  allowedWording: string;
}

export interface CapabilityPolicy {
  version: 1;
  canonical: CapabilityPolicyEntry[];
  transferRules: CapabilityTransferRule[];
}
