import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'mm_mobile_auth_token';
const USER_KEY = 'mm_mobile_user';

export const storage = {
  async getToken() {
    return AsyncStorage.getItem(TOKEN_KEY);
  },
  async setToken(token: string) {
    return AsyncStorage.setItem(TOKEN_KEY, token);
  },
  async clearToken() {
    return AsyncStorage.removeItem(TOKEN_KEY);
  },
  async getUser() {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  async setUser(user: unknown) {
    return AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  async clearUser() {
    return AsyncStorage.removeItem(USER_KEY);
  }
};
