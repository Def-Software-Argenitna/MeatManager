import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../config/firebase';
import type { UserProfile } from '../data/types';
import { apiFetch } from './api';
import { storage } from './storage';

type MeResponse = {
  user: UserProfile;
};

export async function loginWithEmail(email: string, password: string) {
  const credentials = await signInWithEmailAndPassword(auth, email.trim(), password);
  const token = await credentials.user.getIdToken();
  await storage.setToken(token);

  const me = await apiFetch<MeResponse>('/api/firebase-users/me');
  await storage.setUser(me.user);

  return me.user;
}

export async function restoreSession() {
  return storage.getUser();
}

export async function logoutSession() {
  await signOut(auth);
  await storage.clearToken();
  await storage.clearUser();
}
