export const MARKETING_URL =
  (import.meta.env.VITE_MARKETING_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:4321' : 'https://beanies.family');
