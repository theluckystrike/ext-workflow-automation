import { Workflow, WorkflowExecution, WorkflowStep } from '../types';

export class WorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();

  registerWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);
  }

  async execute(workflowId: string, variables: Record<string, unknown> = {}): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const execution: WorkflowExecution = {
      workflowId,
      status: 'running',
      startTime: Date.now(),
      variables: { ...variables }
    };

    this.executions.set(`${workflowId}-${execution.startTime}`, execution);

    try {
      await this.runWorkflow(workflow, execution);
      execution.status = 'completed';
      execution.endTime = Date.now();
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.endTime = Date.now();
    }

    return execution;
  }

  private async runWorkflow(workflow: Workflow, execution: WorkflowExecution): Promise<void> {
    const stepMap = new Map(workflow.steps.map(s => [s.id, s]));
    const runQueue = workflow.steps.filter(s => !workflow.steps.some(p => p.next?.includes(s.id)));
    
    for (const step of runQueue) {
      execution.currentStep = step.id;
      await this.executeStep(step, execution);
    }
  }

  private async executeStep(step: WorkflowStep, execution: WorkflowExecution): Promise<void> {
    switch (step.type) {
      case 'action':
        await this.executeAction(step, execution);
        break;
      case 'condition':
        await this.executeCondition(step, execution);
        break;
      case 'delay':
        await this.executeDelay(step, execution);
        break;
    }
  }

  private async executeAction(step: WorkflowStep, execution: WorkflowExecution): Promise<void> {
    const action = step.config.action as string;
    const params = step.config.params as Record<string, unknown>;
    console.log(`Executing action: ${action}`, params);
    execution.variables[step.id] = { success: true };
  }

  private async executeCondition(step: WorkflowStep, execution: WorkflowExecution): Promise<void> {
    const condition = step.config.condition as string;
    execution.variables[step.id] = { result: true };
  }

  private async executeDelay(step: WorkflowStep, execution: WorkflowExecution): Promise<void> {
    const duration = step.config.duration as number || 1000;
    await new Promise(resolve => setTimeout(resolve, duration));
  }

  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }
}

export const workflowEngine = new WorkflowEngine();
