import { Workflow, WorkflowTrigger } from '../types';
import { workflowEngine } from '../core/WorkflowEngine';

export class WorkflowManager {
  private workflows: Map<string, Workflow> = new Map();
  private triggers: Map<string, chrome.alarms.Alarm> = new Map();

  async create(workflow: Omit<Workflow, 'id'>): Promise<Workflow> {
    const id = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullWorkflow: Workflow = { ...workflow, id };
    
    this.workflows.set(id, fullWorkflow);
    workflowEngine.registerWorkflow(fullWorkflow);
    
    await this.persist();
    return fullWorkflow;
  }

  async update(id: string, updates: Partial<Workflow>): Promise<Workflow | null> {
    const workflow = this.workflows.get(id);
    if (!workflow) return null;
    
    const updated = { ...workflow, ...updates };
    this.workflows.set(id, updated);
    workflowEngine.registerWorkflow(updated);
    
    await this.persist();
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    this.workflows.delete(id);
    await this.persist();
    return true;
  }

  getAll(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  getById(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  async enable(id: string): Promise<void> {
    const workflow = this.workflows.get(id);
    if (workflow) {
      workflow.enabled = true;
      await this.setupTriggers(workflow);
      await this.persist();
    }
  }

  async disable(id: string): Promise<void> {
    const workflow = this.workflows.get(id);
    if (workflow) {
      workflow.enabled = false;
      this.triggers.delete(id);
      await this.persist();
    }
  }

  private async setupTriggers(workflow: Workflow): Promise<void> {
    for (const trigger of workflow.triggers) {
      if (trigger.type === 'scheduled') {
        const interval = trigger.config.interval as number || 60;
        chrome.alarms.create(`workflow-${workflow.id}`, { periodInMinutes: interval });
      }
    }
  }

  private async persist(): Promise<void> {
    const data = Array.from(this.workflows.values());
    await chrome.storage.local.set({ workflows: data });
  }

  async load(): Promise<void> {
    const { workflows = [] } = await chrome.storage.local.get('workflows');
    for (const workflow of workflows) {
      this.workflows.set(workflow.id, workflow);
      workflowEngine.registerWorkflow(workflow);
      if (workflow.enabled) {
        await this.setupTriggers(workflow);
      }
    }
  }
}

export const workflowManager = new WorkflowManager();
