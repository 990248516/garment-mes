export interface FactoryScope {
  factoryId: string;
  factoryName: string;
  dataScopes: Array<'ALL' | 'FACTORY' | 'WORKSHOP' | 'LINE' | 'SELF'>;
  workshopIds: string[];
  productionLineIds: string[];
}

export interface CurrentUser {
  id: string;
  organizationId: string;
  username: string;
  displayName: string;
  workerId: string | null;
  roles: string[];
  permissions: string[];
  factories: FactoryScope[];
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  org: string;
  typ: 'access';
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: {
    claims: AccessTokenClaims;
    user: CurrentUser;
    factoryPermissions: Record<string, string[]>;
  };
  factoryId?: string;
}
