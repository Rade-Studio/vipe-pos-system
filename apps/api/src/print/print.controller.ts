import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import {
  commandPrintSchema,
  CommandPrintRequest,
  CreatedPrinterDevice,
  CreatePrinterRequest,
  createPrinterSchema,
  invoicePrintSchema,
  InvoicePrintRequest,
  PendingPrintJob,
  pendingQuerySchema,
  PrinterDevice,
  PrintJobCreated,
} from './print.dto';
import { PrintService } from './print.service';
import { type PrinterRequest, PrinterTokenGuard } from './printer-token.guard';

@ApiTags('print')
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('print')
export class PrintController {
  constructor(private readonly print: PrintService) {}

  @Post('invoices')
  @ApiCookieAuth()
  @ApiBody({ type: InvoicePrintRequest })
  @ApiCreatedResponse({ type: PrintJobCreated, description: 'Queued; sent to the restaurant printers after commit.' })
  printInvoice(@Body() body: unknown): Promise<PrintJobCreated> {
    return this.print.printInvoice(parseInput(invoicePrintSchema, body));
  }

  @Post('commands')
  @ApiCookieAuth()
  @ApiBody({ type: CommandPrintRequest })
  @ApiCreatedResponse({ type: PrintJobCreated, description: 'Queued kitchen command; its id is the payload invoiceNumber.' })
  printCommand(@Body() body: unknown): Promise<PrintJobCreated> {
    return this.print.printCommand(parseInput(commandPrintSchema, body));
  }

  @Get('jobs/pending')
  @Public()
  @UseGuards(PrinterTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: [PendingPrintJob], description: "Unprinted jobs of the token's restaurant, oldest first, at most 500." })
  @ApiQuery({ name: 'after', required: false, description: 'Job id: return the jobs after it (page until fewer than 500).' })
  @ApiUnauthorizedResponse({ description: 'Missing, unknown or revoked printer token.' })
  pending(@Req() req: PrinterRequest, @Query() query: unknown): Promise<PendingPrintJob[]> {
    return this.print.pending(req.printer!, parseInput(pendingQuerySchema, query).after);
  }

  @Post('jobs/:id/ack')
  @Public()
  @UseGuards(PrinterTokenGuard)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Printed; repeating the ack is a no-op.' })
  @ApiNotFoundResponse({ description: "Not a job of the token's restaurant." })
  @ApiUnauthorizedResponse({ description: 'Missing, unknown or revoked printer token.' })
  ack(@Param('id') id: string, @Req() req: PrinterRequest): Promise<void> {
    return this.print.ack(req.printer!, parseInput(idParamSchema, id));
  }
}

@ApiTags('devices')
@ApiCookieAuth()
@Roles('admin')
@ApiForbiddenResponse({ description: 'Not an admin.' })
@Controller('devices/printers')
export class PrinterDevicesController {
  constructor(private readonly print: PrintService) {}

  @Get()
  @ApiOkResponse({ type: [PrinterDevice] })
  list(): Promise<PrinterDevice[]> {
    return this.print.listPrinters();
  }

  @Post()
  @ApiBody({ type: CreatePrinterRequest })
  @ApiCreatedResponse({ type: CreatedPrinterDevice, description: 'The plaintext token is returned only here.' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid name or unknown fields.' })
  create(@Body() body: unknown): Promise<CreatedPrinterDevice> {
    return this.print.createPrinter(parseInput(createPrinterSchema, body).name);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Revoked (idempotent); its live sockets are disconnected.' })
  @ApiNotFoundResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.print.revokePrinter(parseInput(idParamSchema, id));
  }
}
