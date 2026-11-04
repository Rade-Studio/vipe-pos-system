import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { toErrorResponse } from './error-response';

/** Every error leaves the API as `{statusCode, error, message}`; 5xx causes are logged, never returned. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = toErrorResponse(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    response.status(body.statusCode).json(body);
  }
}
