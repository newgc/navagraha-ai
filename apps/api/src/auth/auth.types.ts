import type { Role } from '@navagraha/domain';
import type { CorrelatedRequest } from '../common/correlation-id.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
  roles: Role[];
}

export type AuthedRequest = CorrelatedRequest & { auth?: AuthContext };
