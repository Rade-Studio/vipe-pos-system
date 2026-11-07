import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { AUTHORIZATION_TARGETS, SUPERVISOR_ACTIONS } from './pins';

export const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});

export class LoginRequest {
  @ApiProperty({ example: 'admin@restaurant.test' })
  email!: string;

  @ApiProperty()
  password!: string;
}

export class SessionUser {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;
}

export class SessionProfile {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'admin' })
  role!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;
}

export class SessionResponse {
  @ApiProperty({ type: SessionUser })
  user!: SessionUser;

  @ApiProperty({ type: SessionProfile })
  profile!: SessionProfile;

  @ApiProperty({
    enum: ['user', 'terminal'],
    description: 'user: a personal login; terminal: a shared order-taking device (POST /auth/terminal/login).',
  })
  sessionKind!: 'user' | 'terminal';
}

export class ChangeOwnPinRequest {
  @ApiProperty({ pattern: '^\\d{4,6}$', description: 'The current PIN.' })
  currentPin!: string;

  @ApiProperty({ pattern: '^\\d{4,6}$', description: '4-6 digits; not one repeated digit, a run (1234, 4321) or a repeated block (1212).' })
  pin!: string;
}

export class IdentifyRequest {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional (F4 compatibility): only this profile is tried. Without it the PIN alone says who it is (F4b).',
  })
  profileId?: string;

  @ApiProperty({ pattern: '^\\d{4,6}$' })
  pin!: string;
}

export class TerminalUnlockRequest {
  @ApiProperty({ format: 'uuid', description: 'The admin or cashier picked on the terminal.' })
  profileId!: string;

  @ApiProperty({ pattern: '^\\d{4,6}$', description: "That supervisor's PIN." })
  pin!: string;
}

export class ActingProfile {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'waiter' }) role!: string;
}

export class IdentifyResponse {
  @ApiProperty({ description: 'Send as the X-Vipe-Acting header on the order writes of this terminal.' })
  token!: string;

  @ApiProperty({ format: 'date-time', description: '5 minutes after the identification.' })
  expiresAt!: string;

  @ApiProperty({ type: ActingProfile })
  profile!: ActingProfile;
}

export class AuthorizeRequest {
  @ApiProperty({ pattern: '^\\d{4,6}$', description: 'PIN of an admin or cashier of the restaurant.' })
  pin!: string;

  @ApiProperty({ enum: SUPERVISOR_ACTIONS })
  action!: (typeof SUPERVISOR_ACTIONS)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Only this supervisor is tried; omitted, every supervisor with a PIN.' })
  profileId?: string;

  @ApiProperty({ enum: AUTHORIZATION_TARGETS, description: 'order for cancel_order and void_item, payment for void_payment (else 422).' })
  targetType!: (typeof AUTHORIZATION_TARGETS)[number];

  @ApiProperty({
    format: 'uuid',
    description:
      'The order or payment to cancel or void. The authorization backs only that target and only an action by the caller (on a shared terminal, the identified staff member).',
  })
  targetId!: string;
}

export class AuthorizationSupervisor {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class AuthorizeResponse {
  @ApiProperty({ format: 'uuid', description: 'Single use, bound to the action, the target, the caller and the restaurant.' })
  authorizationId!: string;

  @ApiProperty({ enum: SUPERVISOR_ACTIONS })
  action!: (typeof SUPERVISOR_ACTIONS)[number];

  @ApiProperty({ enum: AUTHORIZATION_TARGETS }) targetType!: (typeof AUTHORIZATION_TARGETS)[number];

  @ApiProperty({ format: 'uuid' }) targetId!: string;

  @ApiProperty({ type: AuthorizationSupervisor })
  supervisor!: AuthorizationSupervisor;

  @ApiProperty({ format: 'date-time', description: '2 minutes after the authorization.' })
  expiresAt!: string;
}
