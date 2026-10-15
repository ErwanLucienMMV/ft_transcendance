import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  configurationOptions,
  validateEnvironment,
} from '../config/environment.js';
import { databaseOptions } from './database.options.js';

await ConfigModule.forRoot(configurationOptions);

export default new DataSource(
  databaseOptions(validateEnvironment(process.env)),
);
