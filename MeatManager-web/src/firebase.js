import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyCzgv2OrxRrIfmux3BBWe80Um5sukOImEM",
    authDomain: "meat-manager-clientes.firebaseapp.com",
    projectId: "meat-manager-clientes",
    storageBucket: "meat-manager-clientes.firebasestorage.app",
    messagingSenderId: "323504327484",
    appId: "1:323504327484:web:fc6e12fc6a15b474036c39",
    measurementId: "G-4HSB4DH9B9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const fdb = getFirestore(app);
export const auth = getAuth(app);
