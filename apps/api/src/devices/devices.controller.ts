import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/dispositivos')
export class DevicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar() {
    const rows = await this.prisma.accessEvent.findMany({
      distinct: ['deviceName'],
      select: { deviceName: true },
      where: { deviceName: { not: null } },
    });
    return ['Todos', ...rows.map((r) => r.deviceName).filter(Boolean)];
  }
}
