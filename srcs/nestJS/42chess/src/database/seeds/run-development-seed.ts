import source from '../data-source.js';
import { assertDevelopmentSeed, seedDevelopment } from './development-seed.js';

// Validate before opening any connection. Migrations must be applied separately.
assertDevelopmentSeed(process.env);
try {
  await source.initialize();
  await seedDevelopment(source, process.env);
  console.log('Development fixtures inserted; existing rows preserved.');
} finally {
  if (source.isInitialized) await source.destroy();
}
