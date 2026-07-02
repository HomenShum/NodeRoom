export const noderoomSelectors = {
  agentStream: '[data-testid="agent-unified-stream"]',
  agentProgressCard: '[data-testid="agent-progress-card"]',
  binderArtifact: '[data-testid="binder-artifact"]',
  chatComposer: 'textarea[data-testid="chat-composer"]',
  chatModelPreset: '[data-testid="chat-model-preset"]',
  chatModelSpecific: '[data-testid="chat-model-specific"]',
  chatSend: '[data-testid="chat-send"]',
  jobDetail: '[data-testid="job-detail"]',
  jobDetailToggle: '[data-testid="job-detail-toggle"]',
  jobStatus: '[data-testid="job-status"]',
  roomTrace: '[data-testid="room-trace"]',
  sheetSurface: 'table[data-noderoom-surface="workSurface.sheet"]',
} as const;

export const noderoomTextLocators = {
  liveConvex: /live convex/i,
  publicAgentStatus: /Public agent\s*.\s*(done|failed|blocked|idle|running)/i,
  publicAgentDone: /\bPublic agent\s*.\s*done\b/i,
} as const;
