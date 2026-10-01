import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { ContingenciaAuthService } from './contingencia-auth.service';

type RequestWithUser = Request & { contingenciaUser?: string };

@Injectable()
export class ContingenciaAuthGuard implements CanActivate {
  constructor(private readonly auth: ContingenciaAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    req.contingenciaUser = this.auth.verify(token);
    return true;
  }
}

// Usuario local que ya validó ContingenciaAuthGuard.
export const ContingenciaUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<RequestWithUser>().contingenciaUser!,
);
