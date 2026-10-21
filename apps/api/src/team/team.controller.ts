import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { AuthContext, AuthedRequest } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { parseBody } from '../common/zod.js';
import { STAFF_ROLES, TeamService } from './team.service.js';

const RoleChange = z.object({
  phone: z.string().trim().min(1).max(32),
  role: z.enum(STAFF_ROLES),
  action: z.enum(['grant', 'revoke']),
  name: z.string().trim().max(120).optional(),
});

/** Team screen: who has which staff role (MR-36). System Admins only. */
@Controller('admin/team')
@Roles('SYSTEM_ADMIN')
export class TeamController {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  @Get()
  list() {
    return this.team.list();
  }

  @Post('roles')
  @HttpCode(200)
  change(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    return this.team.change(parseBody(RoleChange, body), auth, req.correlationId);
  }
}
