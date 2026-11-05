import { Injectable } from '@nestjs/common';

/** The API's notion of "now", injectable so date boundaries can be tested with a fixed instant. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
