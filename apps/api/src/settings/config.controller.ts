import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { parseInput } from '../common/validation';
import { BusinessConfig, UpdateBusinessConfigRequest, updateConfigSchema } from './business-config';
import { ConfigService } from './config.service';

@ApiTags('config')
@ApiCookieAuth()
@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOkResponse({ type: BusinessConfig, description: 'Every known key, server defaults filled.' })
  get(): Promise<BusinessConfig> {
    return this.config.get();
  }

  @Put()
  @Roles('admin')
  @ApiBody({ type: UpdateBusinessConfigRequest })
  @ApiOkResponse({ type: BusinessConfig, description: 'Upserts the given keys and returns the full config.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid value or unknown key.' })
  update(@Body() body: unknown): Promise<BusinessConfig> {
    return this.config.update(parseInput(updateConfigSchema, body));
  }
}
