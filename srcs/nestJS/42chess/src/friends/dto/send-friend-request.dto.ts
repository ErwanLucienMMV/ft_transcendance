import { IsDefined, IsUUID } from 'class-validator';
import type { UUID } from '../../common/types/api.js';

/** The authenticated principal supplies the sender, never the request body. */
export class SendFriendRequestDto {
  @IsDefined()
  @IsUUID()
  recipientId: UUID;
}
