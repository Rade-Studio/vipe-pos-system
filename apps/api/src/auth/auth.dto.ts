import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

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
}
