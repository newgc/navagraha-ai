import type { Role } from '@navagraha/domain';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from './auth.service.js';
import type { AuthedRequest } from './auth.types.js';
import { IS_PUBLIC, REQUIRED_ROLES } from './decorators.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

/**
 * Global guard: every route needs a valid session unless marked @Public() (NFR-14), and
 * @Roles() routes need a matching role. Denials are audited as security events (EC-53).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const match = req.header('authorization')?.match(BEARER);
    const auth = match ? await this.auth.authenticate(match[1]!) : null;
    if (!auth) throw new UnauthorizedException('Please sign in');
    req.auth = auth;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (required?.length && !required.some((r) => auth.roles.includes(r))) {
      await this.audit.record({
        action: 'security.role_denied',
        correlationId: req.correlationId,
        actorUserId: auth.userId,
        metadata: { method: req.method, path: req.path, required, held: auth.roles },
      });
      throw new ForbiddenException('You do not have access to this');
    }
    return true;
  }
}
