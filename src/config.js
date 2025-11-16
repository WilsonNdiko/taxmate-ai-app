import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { GoogleAuthProvider } from 'firebase/auth';

// Globals (hardcoded for local; override with process.env if needed)
export const appId = process.env.REACT_APP_APP_ID || 'local-dev';
export const initialAuthToken = process.env.REACT_APP_INITIAL_AUTH_TOKEN || null;
export const firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG || '{}');

// Firebase Init
let app, db, auth;
if (Object.keys(firebaseConfig).length > 0) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
}


const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.setCustomParameters({
  prompt: 'select_account' // Forces account picker
});
export { app, db, auth, googleProvider };

