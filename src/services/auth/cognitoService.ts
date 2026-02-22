import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
  type ISignUpResult,
} from 'amazon-cognito-identity-js';
import { getCognitoConfig, isCognitoConfigured } from '@/config/cognito';

let userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool {
  if (!userPool) {
    const config = getCognitoConfig();
    userPool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.clientId,
    });
  }
  return userPool;
}

export interface SignUpParams {
  email: string;
  password: string;
  name: string;
  familyId: string;
  familyRole: string;
}

export interface AuthResult {
  success: boolean;
  session?: CognitoUserSession;
  error?: string;
  challengeName?: string;
  cognitoUser?: CognitoUser;
}

export interface TokenClaims {
  sub: string;
  email: string;
  familyId?: string;
  familyRole?: string;
  exp: number;
  iat: number;
}

/**
 * Sign up a new user with Cognito.
 */
export function signUp(params: SignUpParams): Promise<ISignUpResult> {
  if (!isCognitoConfigured()) {
    return Promise.reject(new Error('Cognito is not configured'));
  }

  const pool = getUserPool();

  const attributeList = [
    new CognitoUserAttribute({ Name: 'email', Value: params.email }),
    new CognitoUserAttribute({ Name: 'name', Value: params.name }),
    new CognitoUserAttribute({ Name: 'custom:familyId', Value: params.familyId }),
    new CognitoUserAttribute({ Name: 'custom:familyRole', Value: params.familyRole }),
  ];

  return new Promise((resolve, reject) => {
    pool.signUp(params.email, params.password, attributeList, [], (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      if (!result) {
        reject(new Error('Sign up returned no result'));
        return;
      }
      resolve(result);
    });
  });
}

/**
 * Confirm a user's sign-up with a verification code.
 */
export function confirmSignUp(email: string, code: string): Promise<void> {
  if (!isCognitoConfigured()) {
    return Promise.reject(new Error('Cognito is not configured'));
  }

  const pool = getUserPool();
  const cognitoUser = new CognitoUser({ Username: email, Pool: pool });

  return new Promise((resolve, reject) => {
    cognitoUser.confirmRegistration(code, true, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

/**
 * Resend the confirmation code for an unverified user.
 */
export function resendConfirmationCode(email: string): Promise<void> {
  if (!isCognitoConfigured()) {
    return Promise.reject(new Error('Cognito is not configured'));
  }

  const pool = getUserPool();
  const cognitoUser = new CognitoUser({ Username: email, Pool: pool });

  return new Promise((resolve, reject) => {
    cognitoUser.resendConfirmationCode((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

/**
 * Sign in with email and password.
 */
export function signIn(email: string, password: string): Promise<AuthResult> {
  if (!isCognitoConfigured()) {
    return Promise.resolve({ success: false, error: 'Cognito is not configured' });
  }

  const pool = getUserPool();

  const cognitoUser = new CognitoUser({
    Username: email,
    Pool: pool,
  });

  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password,
  });

  return new Promise((resolve) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess(session) {
        resolve({ success: true, session });
      },
      onFailure(err) {
        resolve({ success: false, error: err.message || 'Authentication failed' });
      },
      customChallenge() {
        resolve({
          success: false,
          challengeName: 'CUSTOM_CHALLENGE',
          cognitoUser,
        });
      },
      newPasswordRequired() {
        resolve({
          success: false,
          challengeName: 'NEW_PASSWORD_REQUIRED',
          cognitoUser,
        });
      },
    });
  });
}

/**
 * Get the current authenticated user's attributes from Cognito.
 * More reliable than JWT claims for custom attributes.
 */
export function getUserAttributes(): Promise<Record<string, string> | null> {
  if (!isCognitoConfigured()) {
    return Promise.resolve(null);
  }

  const pool = getUserPool();
  const user = pool.getCurrentUser();

  if (!user) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        resolve(null);
        return;
      }

      user.getUserAttributes((attrErr, attributes) => {
        if (attrErr || !attributes) {
          resolve(null);
          return;
        }

        const result: Record<string, string> = {};
        for (const attr of attributes) {
          result[attr.getName()] = attr.getValue();
        }
        resolve(result);
      });
    });
  });
}

/**
 * Sign out the current user.
 */
export function signOut(): void {
  if (!isCognitoConfigured()) return;

  const pool = getUserPool();
  const user = pool.getCurrentUser();
  if (user) {
    user.signOut();
  }
}

/**
 * Get the current session (refreshes if needed).
 */
export function getCurrentSession(): Promise<CognitoUserSession | null> {
  if (!isCognitoConfigured()) {
    return Promise.resolve(null);
  }

  const pool = getUserPool();
  const user = pool.getCurrentUser();

  if (!user) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        resolve(null);
        return;
      }
      resolve(session);
    });
  });
}

/**
 * Refresh the current session.
 */
export function refreshSession(): Promise<CognitoUserSession | null> {
  if (!isCognitoConfigured()) {
    return Promise.resolve(null);
  }

  const pool = getUserPool();
  const user = pool.getCurrentUser();

  if (!user) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        resolve(null);
        return;
      }

      const refreshToken = session.getRefreshToken();
      user.refreshSession(
        refreshToken,
        (refreshErr: Error | null, newSession: CognitoUserSession) => {
          if (refreshErr) {
            resolve(null);
            return;
          }
          resolve(newSession);
        }
      );
    });
  });
}

/**
 * Decode ID token claims without verification (for local use only).
 */
export function getIdTokenClaims(session: CognitoUserSession): TokenClaims {
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload();

  return {
    sub: payload.sub as string,
    email: payload.email as string,
    familyId: payload['custom:familyId'] as string | undefined,
    familyRole: payload['custom:familyRole'] as string | undefined,
    exp: payload.exp as number,
    iat: payload.iat as number,
  };
}

/**
 * Initiate custom auth flow (for magic link).
 */
export function initiateCustomAuth(email: string): Promise<AuthResult> {
  if (!isCognitoConfigured()) {
    return Promise.resolve({ success: false, error: 'Cognito is not configured' });
  }

  const pool = getUserPool();

  const cognitoUser = new CognitoUser({
    Username: email,
    Pool: pool,
  });

  const authDetails = new AuthenticationDetails({
    Username: email,
  });

  return new Promise((resolve) => {
    cognitoUser.initiateAuth(authDetails, {
      onSuccess(session) {
        resolve({ success: true, session });
      },
      onFailure(err) {
        resolve({ success: false, error: err.message || 'Custom auth failed' });
      },
      customChallenge() {
        resolve({
          success: false,
          challengeName: 'CUSTOM_CHALLENGE',
          cognitoUser,
        });
      },
    });
  });
}

/**
 * Respond to a custom auth challenge (e.g., magic link code).
 */
export function respondToMagicLinkChallenge(
  cognitoUser: CognitoUser,
  code: string
): Promise<AuthResult> {
  return new Promise((resolve) => {
    cognitoUser.sendCustomChallengeAnswer(code, {
      onSuccess(session) {
        resolve({ success: true, session });
      },
      onFailure(err) {
        resolve({ success: false, error: err.message || 'Challenge verification failed' });
      },
      customChallenge() {
        resolve({
          success: false,
          challengeName: 'CUSTOM_CHALLENGE',
          error: 'Invalid or expired code',
        });
      },
    });
  });
}
