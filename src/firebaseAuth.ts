import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase App and Auth
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Required Scopes for reading sheets and sending emails
provider.addScope("https://www.googleapis.com/auth/gmail.send");
provider.addScope("https://www.googleapis.com/auth/spreadsheets.readonly");
provider.addScope("https://www.googleapis.com/auth/userinfo.profile");
provider.addScope("https://www.googleapis.com/auth/userinfo.email");

// Force Google to show the account selector, allowing the user to select or use a different account (e.g. ejecutivosyemprendedores@casaroca.org)
provider.setCustomParameters({ prompt: "select_account" });

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Initialize custom auth listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // Token must be obtained via signIn for Workspace APIs
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign-in with Google Pop-up
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get OAuth access token from Google sign in");
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    if (error.code !== "auth/popup-closed-by-user") {
      console.error("Firebase Sign in error:", error);
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
