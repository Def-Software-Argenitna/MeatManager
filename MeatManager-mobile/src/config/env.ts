const fallbackFirebaseConfig = {
  apiKey: 'AIzaSyCzgv2OrxRrIfmux3BBWe80Um5sukOImEM',
  authDomain: 'meat-manager-clientes.firebaseapp.com',
  projectId: 'meat-manager-clientes',
  storageBucket: 'meat-manager-clientes.firebasestorage.app',
  messagingSenderId: '323504327484',
  appId: '1:323504327484:web:fc6e12fc6a15b474036c39',
  measurementId: 'G-4HSB4DH9B9',
};

const trimSlash = (value: string) => value.replace(/\/$/, '');

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || fallbackFirebaseConfig.apiKey,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || fallbackFirebaseConfig.authDomain,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || fallbackFirebaseConfig.projectId,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || fallbackFirebaseConfig.storageBucket,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || fallbackFirebaseConfig.messagingSenderId,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || fallbackFirebaseConfig.appId,
  measurementId:
    process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || fallbackFirebaseConfig.measurementId,
};

export const apiBaseUrl = trimSlash(process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:3001');
