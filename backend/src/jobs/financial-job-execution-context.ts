export interface FinancialJobExecutionContext {
  jobId: string;
  jobType: string;
  orderId: string;
  workerId: string;
  bootId: string;
  leaseId: string;
  leaderOwnerId: string;
  leaderFencingToken: number;
  recoveryGeneration: number;
  abortSignal: AbortSignal;
}

export type FinancialExternalOperationType = 'ENERGY' | 'FORWARD' | 'SEND_BUY';
