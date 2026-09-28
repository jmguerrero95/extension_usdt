import mongoose from 'mongoose';

import type { AppConfig } from '../../app/config/env';

mongoose.set('strictQuery', true);

export const connectToDatabase = async (config: AppConfig): Promise<void> => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(config.mongodbUri, {
    dbName: config.mongodbDbName,
  });
};

export const disconnectFromDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
};

export const isDatabaseReady = (): boolean => mongoose.connection.readyState === 1;
