import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** Same limit as components/ui/image-upload.tsx, now enforced by the API and the signed Content-Length. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_KINDS = ['dish'] as const;

/**
 * `image/<subtype>`. SVG is refused: it can carry scripts and the bucket
 * serves it as-is to anyone.
 */
const IMAGE_TYPE = /^image\/([a-z0-9][a-z0-9.+-]{0,49})$/i;

export const createUploadSchema = z.strictObject({
  kind: z.enum(UPLOAD_KINDS),
  contentType: z
    .string()
    .refine((value) => IMAGE_TYPE.test(value) && !/^image\/svg/i.test(value), 'Only image uploads are allowed'),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES, 'Images are limited to 5 MB'),
});

export const deleteObjectSchema = z.strictObject({ publicUrl: z.string().max(2048) });

/** File extension of the key from the content type (`image/jpeg` -> `jpg`, `image/x-icon` -> `xicon`). */
export function extensionOf(contentType: string): string {
  const subtype = IMAGE_TYPE.exec(contentType)![1].toLowerCase();
  return subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '');
}

export class CreateUploadRequest {
  @ApiProperty({ enum: UPLOAD_KINDS }) kind!: (typeof UPLOAD_KINDS)[number];
  @ApiProperty({ example: 'image/png', description: 'image/* except SVG. The PUT must send this exact Content-Type.' })
  contentType!: string;
  @ApiProperty({ minimum: 1, maximum: MAX_IMAGE_BYTES, description: 'Bytes. The PUT must send exactly this Content-Length.' })
  size!: number;
}

export class UploadTicket {
  @ApiProperty({ description: 'Presigned PUT URL, valid for 5 minutes, bound to the declared Content-Type and size.' })
  uploadUrl!: string;
  @ApiProperty({ example: '<restaurantId>/dishes/<uuid>.png' }) key!: string;
  @ApiProperty({ description: 'Public read URL of the object once uploaded; store it as the dish imageUrl.' })
  publicUrl!: string;
}

export class DeleteObjectRequest {
  @ApiProperty({ description: "A publicUrl from POST /storage/uploads; must be under S3_PUBLIC_BASE_URL and the caller's restaurant." })
  publicUrl!: string;
}
