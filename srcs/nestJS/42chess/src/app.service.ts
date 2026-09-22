import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World! We are ready to code, and passing the live dev test';
  }
}
