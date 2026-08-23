import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

@Controller('media/event-photos')
export class MediaController {
  private readonly dir = join(process.cwd(), 'data', 'event-photos');

  @Get(':file')
  servir(@Param('file') file: string, @Res() res: Response) {
    if (!/^[a-zA-Z0-9_.-]+\.jpg$/.test(file)) throw new NotFoundException();
    const filePath = join(this.dir, file);
    if (!existsSync(filePath)) throw new NotFoundException();
    res.sendFile(filePath);
  }
}
