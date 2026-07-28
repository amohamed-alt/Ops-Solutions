export type ScheduleHealth = {
  state: 'paused' | 'failed' | 'delayed' | 'healthy' | 'pending';
  label: string;
  detail: string;
};

export function scheduleHealth(schedule: Record<string, unknown>, now?: Date): ScheduleHealth;
export function scheduleUpdatePayload(schedule: Record<string, unknown>, enabled: boolean): Record<string, unknown>;
export function executionStatusLabel(execution: Record<string, unknown>): string;
