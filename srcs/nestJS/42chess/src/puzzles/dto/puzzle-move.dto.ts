import { IsInt, Matches, Max, Min } from 'class-validator';

export class PuzzleMoveDto {
  @Matches(/^[a-h][1-8][a-h][1-8][qrbn]?$/)
  move: string;

  @IsInt()
  @Min(0)
  @Max(2147483646)
  version: number;
}
