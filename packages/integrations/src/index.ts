export interface IntegrationPlanChange {
  filePath: string;
  selector?: string;
  currentValue: string;
  proposedValue: string;
}

export interface SiteIntegrationProvider {
  readonly key: string;
  plan(input: unknown): Promise<IntegrationPlanChange[]>;
  install(input: { selectedChanges: IntegrationPlanChange[] }): Promise<{ changedFiles: string[] }>;
  verify(input: unknown): Promise<{ ok: boolean; notes: string[] }>;
  uninstall(input: unknown): Promise<{ changedFiles: string[]; conflicts: IntegrationPlanChange[] }>;
}
