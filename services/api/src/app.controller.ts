import { Controller, Get } from '@nestjs/common';
import { Public } from './domains/identity-access/guards/auth.guard';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'mlv-api',
      timestamp: new Date().toISOString(),
    };
  }
}
