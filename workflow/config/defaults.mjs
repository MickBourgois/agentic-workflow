export const WORKFLOW_DEFAULTS = Object.freeze({
  tracker: {
    provider: 'linear',
    team: null,
    cardPattern: '^[A-Z][A-Z0-9]*-[0-9]+$',
    statuses: {
      backlog: 'Backlog',
      ready: 'Todo',
      implementing: 'In Progress',
      reviewing: 'In Review',
      rework: 'Rework',
      merging: 'Merging',
      done: 'Done',
      canceled: 'Canceled',
    },
    labels: {
      hardened: 'hardened',
      readyForAgent: 'ready-for-agent',
      needsInfo: 'needs-info',
      complexityPrefix: 'complexity:',
    },
  },
  git: {
    remote: 'origin',
    baseBranch: 'auto',
    branchPattern: '<type>/<card-lower>-<slug>',
  },
  commands: {
    install: 'auto',
    fullCheck: 'auto',
  },
  worktree: {
    root: '.delivery/worktrees',
  },
  environment: {
    copyFiles: [],
    warnings: [],
  },
  delivery: {
    maxReworkCycles: 2,
    maxEscalations: 1,
  },
})

export const ROUTES = Object.freeze({
  simple: {
    implementation: { model: 'gpt-5.6-terra', reasoning: 'medium' },
    reviewers: [{ model: 'gpt-5.6-terra', reasoning: 'medium' }],
  },
  standard: {
    implementation: { model: 'gpt-5.6-terra', reasoning: 'high' },
    reviewers: [{ model: 'gpt-5.6-terra', reasoning: 'high' }],
  },
  complex: {
    implementation: { model: 'gpt-5.6-sol', reasoning: 'medium' },
    reviewers: [{ model: 'gpt-5.6-sol', reasoning: 'high' }],
  },
  critical: {
    implementation: { model: 'gpt-5.6-sol', reasoning: 'high' },
    reviewers: [
      { model: 'gpt-5.6-sol', reasoning: 'high' },
      { model: 'gpt-5.6-terra', reasoning: 'high' },
    ],
  },
})

export const FIXED_ROUTES = Object.freeze({
  orchestrator: { model: 'gpt-5.6-terra', reasoning: 'medium' },
  backlogSelector: { model: 'gpt-5.6-luna', reasoning: 'low' },
  shipper: { model: 'gpt-5.6-terra', reasoning: 'medium' },
})
