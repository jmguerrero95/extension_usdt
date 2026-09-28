import { randomUUID } from 'node:crypto';

export interface BootContext {
  bootId: string;
  bootStartedAt: Date;
}

export const createBootContext = (): BootContext => ({
  bootId: randomUUID(),
  bootStartedAt: new Date(),
});
