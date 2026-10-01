import { Body, Controller, Get, HttpCode, Ip, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ContingenciaAuthService } from './contingencia-auth.service';
import { ContingenciaAuthGuard, ContingenciaUser } from './contingencia-auth.guard';
import { ContingenciaService, NuevaVisita } from './contingencia.service';
import { DirectorySyncService } from './directory-sync.service';

@Controller('api/contingencia')
export class ContingenciaController {
  constructor(
    private readonly auth: ContingenciaAuthService,
    private readonly contingencia: ContingenciaService,
    private readonly directory: DirectorySyncService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body('username') username: string, @Body('password') password: string, @Ip() ip: string) {
    return this.auth.login(username, password, ip);
  }

  @Get('estado')
  @UseGuards(ContingenciaAuthGuard)
  estado() {
    return this.contingencia.estado();
  }

  @Get('directorio')
  @UseGuards(ContingenciaAuthGuard)
  directorio() {
    return this.contingencia.directorio();
  }

  @Post('directorio/actualizar')
  @HttpCode(200)
  @UseGuards(ContingenciaAuthGuard)
  actualizarDirectorio() {
    return this.directory.refresh();
  }

  @Get('visitas')
  @UseGuards(ContingenciaAuthGuard)
  listar(@Query() query: Record<string, string>) {
    return this.contingencia.listar({
      status: query.status,
      q: query.q,
      fecha: query.fecha,
      page: query.page ? Number(query.page) : undefined,
    });
  }

  @Post('visitas')
  @UseGuards(ContingenciaAuthGuard)
  registrar(@Body() body: NuevaVisita, @ContingenciaUser() usuario: string) {
    return this.contingencia.registrar(body ?? {}, usuario);
  }

  @Post('visitas/:id/salida')
  @HttpCode(200)
  @UseGuards(ContingenciaAuthGuard)
  salida(@Param('id', ParseIntPipe) id: number, @ContingenciaUser() usuario: string) {
    return this.contingencia.registrarSalida(id, usuario);
  }

  @Post('visitas/:id/pluma')
  @HttpCode(200)
  @UseGuards(ContingenciaAuthGuard)
  abrirPluma(@Param('id', ParseIntPipe) id: number, @ContingenciaUser() usuario: string) {
    return this.contingencia.abrirPluma(id, usuario);
  }

  @Post('emergencia')
  @HttpCode(200)
  @UseGuards(ContingenciaAuthGuard)
  emergencia(@Body('notes') notes: string | undefined, @ContingenciaUser() usuario: string) {
    return this.contingencia.emergencia(notes, usuario);
  }
}
