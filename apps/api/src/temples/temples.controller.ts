import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { TemplesService } from './temples.service.js';

const CODE = /^[A-Z0-9-]{3,32}$/;

function validCode(value: string, what: string): string {
  if (!CODE.test(value)) throw new BadRequestException(`Invalid ${what}`);
  return value;
}

/** FS §15: GET /temples, GET /temples/{id}. Public, read-only. */
@Controller('temples')
export class TemplesController {
  constructor(@Inject(TemplesService) private readonly temples: TemplesService) {}

  @Get()
  async list(@Query('circuit') circuit = 'NAVAGRAHA') {
    const temples = await this.temples.listByCircuit(validCode(circuit, 'circuit code'));
    if (!temples) throw new NotFoundException('Circuit not found');
    return { circuit, temples };
  }

  @Get(':code')
  async get(@Param('code') code: string) {
    const temple = await this.temples.getByCode(validCode(code, 'temple code'));
    if (!temple) throw new NotFoundException('Temple not found');
    return temple;
  }
}
