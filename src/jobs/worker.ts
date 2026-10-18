import { jobRunner } from './runner';
import logger from '@/src/lib/logger';

let isRunning = true;

async function startWorker() {
  logger.info('Starting FindIt background worker process...');

  const shutdown = () => {
    logger.info('Shutting down background worker...');
    isRunning = false;
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (isRunning) {
    try {
      const { processed, errors } = await jobRunner.tick(10);
      if (processed > 0 || errors > 0) {
        logger.info({ processed, errors }, 'Worker cycle completed');
      }
    } catch (err) {
      logger.error({ err }, 'Worker tick loop encountered an error');
    }

    // Sleep for 2 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  logger.info('Background worker stopped gracefully.');
  process.exit(0);
}

startWorker().catch((err) => {
  logger.fatal({ err }, 'Fatal error in worker daemon');
  process.exit(1);
});
