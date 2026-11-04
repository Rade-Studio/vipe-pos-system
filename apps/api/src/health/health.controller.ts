import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

export class HealthResponse {
  status!: 'ok';
  service!: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ type: HealthResponse })
  health(): HealthResponse {
    return { status: 'ok', service: 'vipe-pos-api' };
  }
}
