import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/** Serializes as the JSON literal `null` (JSON.stringify calls toJSON). */
const JSON_NULL = Object.freeze({ toJSON: () => null });

/**
 * Nest's Express adapter sends an empty body for a null return value. Routes
 * whose contract is "the resource or null" use this interceptor so the client
 * gets 200 with the body `null`. It maps the value only; the response is still
 * written by Nest after the request unit of work committed.
 */
@Injectable()
export class JsonNullInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => (value === null ? JSON_NULL : value)));
  }
}
