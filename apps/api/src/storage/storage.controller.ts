import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { parseInput } from '../common/validation';
import { CreateUploadRequest, createUploadSchema, DeleteObjectRequest, deleteObjectSchema, UploadTicket } from './storage.dto';
import { StorageService } from './storage.service';

@ApiTags('storage')
@ApiCookieAuth()
@Roles('admin')
@ApiForbiddenResponse({ description: 'Not an admin.' })
@ApiServiceUnavailableResponse({ description: 'Storage is not configured (no S3_* variables).' })
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('uploads')
  @ApiBody({ type: CreateUploadRequest })
  @ApiCreatedResponse({ type: UploadTicket })
  @ApiUnprocessableEntityResponse({ description: 'Not an image (SVG included), over 5 MB, unknown kind or fields.' })
  createUpload(@Body() body: unknown): Promise<UploadTicket> {
    this.storage.assertConfigured();
    return this.storage.createUpload(parseInput(createUploadSchema, body));
  }

  @Delete('objects')
  @HttpCode(204)
  @ApiBody({ type: DeleteObjectRequest })
  @ApiNoContentResponse({ description: 'Deleted (also when it did not exist).' })
  @ApiUnprocessableEntityResponse({ description: "Not under S3_PUBLIC_BASE_URL or not an object of the caller's restaurant." })
  deleteObject(@Body() body: unknown): Promise<void> {
    this.storage.assertConfigured();
    return this.storage.deleteObject(parseInput(deleteObjectSchema, body).publicUrl);
  }
}
