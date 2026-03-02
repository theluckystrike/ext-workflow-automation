export type WorkflowStepType = 'action' | 'condition' | 'loop' | 'delay';

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  config: Record<string, unknown>;
  next?: string[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  triggers: WorkflowTrigger[];
  enabled: boolean;
}

export interface WorkflowTrigger {
  type: 'manual' | 'scheduled' | 'event';
  config: Record<string, unknown>;
}

export interface WorkflowExecution {
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  currentStep?: string;
  variables: Record<string, unknown>;
  error?: string;
}
