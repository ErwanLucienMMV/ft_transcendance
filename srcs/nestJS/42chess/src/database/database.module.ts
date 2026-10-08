import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Environment } from '../config/environment.js';
import { databaseOptions } from './database.options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        ...databaseOptions({
          APIPORT: config.get('APIPORT', { infer: true }),
          DATABASE_HOST: config.get('DATABASE_HOST', { infer: true }),
          DATABASE_PORT: config.get('DATABASE_PORT', { infer: true }),
          DATABASE_NAME: config.get('DATABASE_NAME', { infer: true }),
          DATABASE_USER: config.get('DATABASE_USER', { infer: true }),
          DATABASE_PASSWORD: config.get('DATABASE_PASSWORD', { infer: true }),
        }),
        autoLoadEntities: true,
        retryAttempts: 3,
        retryDelay: 1000,
      }),
    }),
  ],
})
export class DatabaseModule {}
