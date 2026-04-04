const trimSlash = (value: string | undefined) => String(value || '').replace(/\/$/, '');

export const env = {
  apiUrl: trimSlash(process.env.EXPO_PUBLIC_API_URL) || 'http://127.0.0.1:3001',
  useMocks: String(process.env.EXPO_PUBLIC_USE_MOBILE_MOCKS || 'true') === 'true'
};
