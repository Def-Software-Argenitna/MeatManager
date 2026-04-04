import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCzgv2OrxRrIfmux3BBWe80Um5sukOImEM',
  authDomain: 'meat-manager-clientes.firebaseapp.com',
  projectId: 'meat-manager-clientes',
  storageBucket: 'meat-manager-clientes.firebasestorage.app',
  messagingSenderId: '323504327484',
  appId: '1:323504327484:web:fc6e12fc6a15b474036c39'
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });
  } catch {
    return getAuth(app);
  }
})();
