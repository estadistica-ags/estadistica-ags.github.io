import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// Firebase project configuration
const firebaseConfig = {
  apiKey: 'AIzaSyCmtN2gcRtoC93DXKZC1QqOEFfdhUtciZ4',
  authDomain: 'estadistica-ags.firebaseapp.com',
  projectId: 'estadistica-ags',
  storageBucket: 'estadistica-ags.firebasestorage.app',
  messagingSenderId: '903807585037',
  appId: '1:903807585037:web:34ba22ebdaf827a6c7be44'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
