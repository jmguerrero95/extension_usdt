import 'dotenv/config';

import { bootstrapApplication } from './bootstrap';

const start = async () => {
  const { app, config } = await bootstrapApplication();

  try {
    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });
  } catch (error) {
    app.log.error(error, 'No fue posible iniciar el servidor');
    process.exit(1);
  }
};

void start();
