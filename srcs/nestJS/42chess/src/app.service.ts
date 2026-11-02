import { Injectable } from '@nestjs/common';

export interface ApiDescription {
  name: string;
  version: string;
}

@Injectable()
export class AppService {
  /** What `GET /api/` answers: enough to tell the API is the one expected. */
  describe(): ApiDescription {
    return { name: '42chess API', version: 'v1' };
  }
}
