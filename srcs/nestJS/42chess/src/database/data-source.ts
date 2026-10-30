import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import {
  configurationOptions,
  validateDatabaseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from './database.options.js';
import { CheckedDataSource } from './database-preflight.js';

// Migrations only need the database settings, not the app secrets.
await ConfigModule.forRoot({
  ...configurationOptions,
  validate: validateDatabaseEnvironment,
});

export default new CheckedDataSource(
  databaseOptions(validateDatabaseEnvironment(process.env)),
);
