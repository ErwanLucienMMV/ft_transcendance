import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { SessionModule } from '../auth/session.module.js';
import { ChessEngineService } from '../chess/chess-engine.service.js';
import { Puzzle } from './puzzles.entity.js';
import { PuzzleAttempt } from './puzzle-attempts.entity.js';
import { DailyPuzzle } from './daily-puzzles.entity.js';
import { PuzzlesController } from './puzzles.controller.js';
import { PuzzlesService } from './puzzles.service.js';
import { PuzzleRulesService } from './puzzle-rules.service.js';

@Module({
  imports: [
    AuthModule,
    SessionModule,
    TypeOrmModule.forFeature([Puzzle, PuzzleAttempt, DailyPuzzle]),
  ],
  controllers: [PuzzlesController],
  providers: [PuzzlesService, PuzzleRulesService, ChessEngineService],
  exports: [PuzzlesService, PuzzleRulesService],
})
export class PuzzlesModule {}
