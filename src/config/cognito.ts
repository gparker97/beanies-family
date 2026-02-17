export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

export function getCognitoConfig(): CognitoConfig {
  return {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
    region: import.meta.env.VITE_COGNITO_REGION ?? 'us-east-1',
  };
}

export function isCognitoConfigured(): boolean {
  const config = getCognitoConfig();
  return config.userPoolId !== '' && config.clientId !== '';
}
