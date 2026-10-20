import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@navagraha/domain';
import type { AuthedRequest, AuthContext } from './auth.types.js';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLES = 'auth:roles';

/** Opt a route out of sign-in. Every route requires sign-in by default (NFR-14). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route to users holding at least one of these roles (MR-36). */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/** The signed-in user on a protected route. */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext =>
    ctx.switchToHttp().getRequest<AuthedRequest>().auth!,
);
