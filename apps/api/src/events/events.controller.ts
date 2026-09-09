import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { EventsService, ListaFiltros } from './events.service';

@Controller('api/cruces')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  listar(@Query() query: Record<string, string>) {
    const f: ListaFiltros = {
      desde: query.desde,
      hasta: query.hasta,
      q: query.q,
      dispositivo: query.dispositivo,
      sentido: query.sentido as ListaFiltros['sentido'],
      lectura: query.lectura as ListaFiltros['lectura'],
      umbral: query.umbral ? Number(query.umbral) : undefined,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    };
    return this.events.listar(f);
  }

  @Get('resumen')
  resumen(@Query() query: Record<string, string>) {
    const f: ListaFiltros = {
      desde: query.desde,
      hasta: query.hasta,
      q: query.q,
      dispositivo: query.dispositivo,
      sentido: query.sentido as ListaFiltros['sentido'],
      umbral: query.umbral ? Number(query.umbral) : undefined,
    };
    return this.events.resumen(f);
  }

  @Get('por-casa')
  porCasa(@Query() query: Record<string, string>) {
    return this.events.porCasa(query.desde, query.hasta);
  }

  @Patch(':id/placa')
  capturarManual(@Param('id', ParseIntPipe) id: number, @Body('placa') placa: string) {
    return this.events.capturarPlacaManual(id, placa);
  }
}
