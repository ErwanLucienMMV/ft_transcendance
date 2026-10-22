import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  configurationOptions,
  validateDatabaseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from './database.options.js';

// Migrations only need the database settings, not the app secrets.
await ConfigModule.forRoot({
  ...configurationOptions,
  validate: validateDatabaseEnvironment,
});

export default new DataSource(
  databaseOptions(validateDatabaseEnvironment(process.env)),
);
