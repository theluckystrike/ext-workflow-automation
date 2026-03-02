// Core types for the workflow automation engine

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: WorkflowTrigger[];
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  config: WorkflowConfig;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
}

export interface WorkflowStep {
  id: string;
  type: 'trigger' | 'condition' | 'action';
  name: string;
  config: Record<string, any>;
  nextStepId?: string;
}

export interface WorkflowTrigger {
  id: string;
  type: 'chrome-event' | 'schedule' | 'webhook' | 'manual' | 'storage-change' | 'tab-update';
  name: string;
  config: TriggerConfig;
}

export interface TriggerConfig {
  eventType?: string;
  schedule?: ScheduleConfig;
  webhookUrl?: string;
  storageKey?: string;
  tabPatterns?: string[];
}

export interface ScheduleConfig {
  cron?: string;
  interval?: number;
  timezone?: string;
}

export interface WorkflowAction {
  id: string;
  type: string;
  name: string;
  config: ActionConfig;
  retryConfig?: RetryConfig;
}

export interface ActionConfig {
  action: string;
  params: Record<string, any>;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier?: number;
}

export interface WorkflowCondition {
  id: string;
  type: string;
  name: string;
  config: ConditionConfig;
}

export interface ConditionConfig {
  operator: 'and' | 'or' | 'not';
  conditions: NestedCondition[];
}

export interface NestedCondition {
  field: string;
  operator: 'equals' | 'not-equals' | 'contains' | 'greater-than' | 'less-than' | 'regex';
  value: any;
}

export interface WorkflowConfig {
  maxConcurrentRuns?: number;
  timeout?: number;
  continueOnError?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  error?: string;
  steps: WorkflowStepExecution[];
  context: ExecutionContext;
}

export interface WorkflowStepExecution {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  output?: any;
  error?: string;
}

export interface ExecutionContext {
  triggerData: any;
  previousStepOutputs: Map<string, any>;
  variables: Record<string, any>;
}

export interface WorkflowEvent {
  type: 'workflow.started' | 'workflow.completed' | 'workflow.failed' | 'step.completed' | 'step.failed';
  workflowId: string;
  executionId: string;
  timestamp: number;
  data: any;
}
