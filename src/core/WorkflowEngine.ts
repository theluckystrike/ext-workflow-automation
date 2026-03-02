// Main Workflow Engine - orchestrates workflow execution

import { Workflow, WorkflowExecution, WorkflowEvent, ExecutionContext, WorkflowStepExecution } from './types';
import { TriggerRegistry } from '../triggers/TriggerRegistry';
import { ActionRegistry } from '../actions/ActionRegistry';
import { ConditionRegistry } from '../conditions/ConditionRegistry';
import { WorkflowStorage } from '../storage/WorkflowStorage';

type EventCallback = (event: WorkflowEvent) => void;

export class WorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private triggerRegistry: TriggerRegistry;
  private actionRegistry: ActionRegistry;
  private conditionRegistry: ConditionRegistry;
  private storage: WorkflowStorage;
  private eventListeners: Map<string, EventCallback[]> = new Map();
  private runningExecutions: Set<string> = new Set();
  private maxConcurrentRuns: number = 5;

  constructor(options: { storage?: WorkflowStorage; maxConcurrentRuns?: number } = {}) {
    this.storage = options.storage || new WorkflowStorage();
    this.maxConcurrentRuns = options.maxConcurrentRuns || 5;
    
    this.triggerRegistry = new TriggerRegistry();
    this.actionRegistry = new ActionRegistry();
    this.conditionRegistry = new ConditionRegistry();
    
    this.initializeDefaultTriggers();
    this.initializeDefaultActions();
    this.initializeDefaultConditions();
  }

  private initializeDefaultTriggers(): void {
    // Register built-in triggers
    this.triggerRegistry.register('chrome-event', require('../triggers/ChromeTrigger'));
    this.triggerRegistry.register('schedule', require('../triggers/ScheduleTrigger'));
    this.triggerRegistry.register('storage-change', require('../triggers/StorageTrigger'));
    this.triggerRegistry.register('tab-update', require('../triggers/TabTrigger'));
  }

  private initializeDefaultActions(): void {
    // Register built-in actions
    this.actionRegistry.register('chrome-notification', require('../actions/ChromeAction'));
    this.actionRegistry.register('storage-set', require('../actions/StorageAction'));
    this.actionRegistry.register('tab-create', require('../actions/TabAction'));
    this.actionRegistry.register('script-inject', require('../actions/ScriptAction'));
    this.actionRegistry.register('http-request', require('../actions/HttpAction'));
  }

  private initializeDefaultConditions(): void {
    // Register built-in conditions
    this.conditionRegistry.register('storage-equals', require('../conditions/StorageCondition'));
    this.conditionRegistry.register('tab-matches', require('../conditions/TabCondition'));
    this.conditionRegistry.register('url-pattern', require('../conditions/UrlCondition'));
  }

  async initialize(): Promise<void> {
    const savedWorkflows = await this.storage.loadAll();
    savedWorkflows.forEach(workflow => {
      this.workflows.set(workflow.id, workflow);
    });
    
    // Register trigger listeners for enabled workflows
    for (const [id, workflow] of this.workflows) {
      if (workflow.enabled) {
        await this.registerWorkflowTriggers(workflow);
      }
    }
  }

  private async registerWorkflowTriggers(workflow: Workflow): Promise<void> {
    for (const trigger of workflow.triggers) {
      const triggerHandler = this.triggerRegistry.get(trigger.type);
      if (triggerHandler) {
        await triggerHandler.register(workflow.id, trigger.config, (data) => {
          this.executeWorkflow(workflow.id, data);
        });
      }
    }
  }

  async createWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>): Promise<Workflow> {
    const id = this.generateId();
    const newWorkflow: Workflow = {
      ...workflow,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0
    };
    
    this.workflows.set(id, newWorkflow);
    await this.storage.save(newWorkflow);
    
    if (newWorkflow.enabled) {
      await this.registerWorkflowTriggers(newWorkflow);
    }
    
    this.emit('workflow.created', { workflowId: id, workflow: newWorkflow });
    return newWorkflow;
  }

  async updateWorkflow(id: string, updates: Partial<Workflow>): Promise<Workflow | null> {
    const workflow = this.workflows.get(id);
    if (!workflow) return null;
    
    const updatedWorkflow = {
      ...workflow,
      ...updates,
      updatedAt: Date.now()
    };
    
    this.workflows.set(id, updatedWorkflow);
    await this.storage.save(updatedWorkflow);
    
    return updatedWorkflow;
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;
    
    // Unregister triggers
    for (const trigger of workflow.triggers) {
      const triggerHandler = this.triggerRegistry.get(trigger.type);
      if (triggerHandler) {
        await triggerHandler.unregister(id);
      }
    }
    
    this.workflows.delete(id);
    await this.storage.delete(id);
    
    this.emit('workflow.deleted', { workflowId: id });
    return true;
  }

  async executeWorkflow(workflowId: string, triggerData?: any): Promise<WorkflowExecution | null> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || !workflow.enabled) return null;
    
    // Check concurrent execution limit
    if (this.runningExecutions.size >= this.maxConcurrentRuns) {
      console.warn(`Max concurrent runs (${this.maxConcurrentRuns}) reached, queuing workflow ${workflowId}`);
      return null;
    }
    
    const execution: WorkflowExecution = {
      id: this.generateId(),
      workflowId,
      status: 'running',
      startedAt: Date.now(),
      steps: [],
      context: {
        triggerData,
        previousStepOutputs: new Map(),
        variables: {}
      }
    };
    
    this.executions.set(execution.id, execution);
    this.runningExecutions.add(execution.id);
    
    this.emit('workflow.started', {
      workflowId,
      executionId: execution.id,
      triggerData
    });
    
    try {
      // Check conditions
      const conditionsPassed = await this.evaluateConditions(workflow.conditions, execution.context);
      if (!conditionsPassed) {
        execution.status = 'completed';
        execution.completedAt = Date.now();
        this.emit('workflow.completed', { workflowId, executionId: execution.id, skipped: true });
        return execution;
      }
      
      // Execute actions in sequence
      for (const action of workflow.actions) {
        const stepExecution = await this.executeAction(action, execution.context);
        execution.steps.push(stepExecution);
        
        if (stepExecution.status === 'failed') {
          if (!workflow.config.continueOnError) {
            throw new Error(stepExecution.error || 'Action failed');
          }
        }
        
        execution.context.previousStepOutputs.set(action.id, stepExecution.output);
      }
      
      execution.status = 'completed';
      execution.completedAt = Date.now();
      
      // Update workflow stats
      workflow.runCount++;
      workflow.lastRunAt = Date.now();
      await this.storage.save(workflow);
      
      this.emit('workflow.completed', { workflowId, executionId: execution.id });
      
    } catch (error) {
      execution.status = 'failed';
      execution.completedAt = Date.now();
      execution.error = error instanceof Error ? error.message : String(error);
      
      this.emit('workflow.failed', {
        workflowId,
        executionId: execution.id,
        error: execution.error
      });
    } finally {
      this.runningExecutions.delete(execution.id);
    }
    
    return execution;
  }

  private async evaluateConditions(conditions: WorkflowCondition[], context: ExecutionContext): Promise<boolean> {
    if (conditions.length === 0) return true;
    
    for (const condition of conditions) {
      const conditionHandler = this.conditionRegistry.get(condition.type);
      if (!conditionHandler) {
        console.warn(`Condition type ${condition.type} not found, skipping`);
        continue;
      }
      
      const result = await conditionHandler.evaluate(condition.config, context);
      if (!result && condition.config.operator === 'and') {
        return false;
      }
      if (result && condition.config.operator === 'or') {
        return true;
      }
    }
    
    return true;
  }

  private async executeAction(action: WorkflowAction, context: ExecutionContext): Promise<WorkflowStepExecution> {
    const stepExecution: WorkflowStepExecution = {
      stepId: action.id,
      status: 'running',
      startedAt: Date.now()
    };
    
    try {
      const actionHandler = this.actionRegistry.get(action.type);
      if (!actionHandler) {
        throw new Error(`Action type ${action.type} not found`);
      }
      
      // Prepare action context with previous outputs and variables
      const actionContext = {
        ...context,
        previousOutputs: Object.fromEntries(context.previousStepOutputs),
        variables: context.variables
      };
      
      let lastError: Error | null = null;
      let retries = action.retryConfig?.maxRetries || 0;
      
      while (retries >= 0) {
        try {
          stepExecution.output = await actionHandler.execute(action.config.params, actionContext);
          stepExecution.status = 'completed';
          stepExecution.completedAt = Date.now();
          
          this.emit('step.completed', {
            stepId: action.id,
            output: stepExecution.output
          });
          
          return stepExecution;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retries--;
          
          if (retries >= 0) {
            const delay = (action.retryConfig?.retryDelay || 1000) * 
              Math.pow(action.retryConfig?.backoffMultiplier || 2, 
              action.retryConfig!.maxRetries - retries);
            await this.sleep(delay);
          }
        }
      }
      
      throw lastError;
      
    } catch (error) {
      stepExecution.status = 'failed';
      stepExecution.completedAt = Date.now();
      stepExecution.error = error instanceof Error ? error.message : String(error);
      
      this.emit('step.failed', {
        stepId: action.id,
        error: stepExecution.error
      });
      
      return stepExecution;
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  on(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback({
            type: event,
            ...data,
            timestamp: Date.now()
          });
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }

  getWorkflowExecutions(workflowId: string): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter(e => e.workflowId === workflowId);
  }
}
