import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiQuery, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { parseInput } from '../common/validation';
import { AUDIT_EVENT_TYPES, AUDIT_LIST_LIMIT, AuditEvent, auditQuerySchema } from './audit.dto';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiCookieAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('admin')
  @ApiQuery({ name: 'from', required: false, description: "YYYY-MM-DD: events from that day (restaurant's timezone)." })
  @ApiQuery({ name: 'to', required: false, description: "YYYY-MM-DD: events up to that day included (restaurant's timezone)." })
  @ApiQuery({ name: 'type', required: false, description: `Comma-separated: ${AUDIT_EVENT_TYPES.join(', ')}.` })
  @ApiQuery({ name: 'actorId', required: false, description: 'Profile who cancelled or voided.' })
  @ApiQuery({ name: 'authorizerId', required: false, description: 'Supervisor who authorized.' })
  @ApiQuery({ name: 'selfAuthorized', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({ type: [AuditEvent], description: `Cancellations and voids, newest first, at most ${AUDIT_LIST_LIMIT}.` })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid filter.' })
  list(@Query() query: unknown): Promise<AuditEvent[]> {
    return this.audit.list(parseInput(auditQuerySchema, query));
  }
}
