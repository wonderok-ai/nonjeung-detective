"use client";

import { getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
  where,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const requiredFirebaseConfig = [
  ["NEXT_PUBLIC_FIREBASE_API_KEY", firebaseConfig.apiKey],
  ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
  ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
  ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", firebaseConfig.storageBucket],
  ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", firebaseConfig.messagingSenderId],
  ["NEXT_PUBLIC_FIREBASE_APP_ID", firebaseConfig.appId],
] as const;

function isRealFirebaseValue(value: string | undefined) {
  if (!value) return false;
  return ![
    "your_api_key",
    "your-project.firebaseapp.com",
    "your-project-id",
    "your-project.firebasestorage.app",
    "000000000000",
    "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx",
  ].includes(value);
}

export const missingFirebaseEnv = requiredFirebaseConfig
  .filter(([, value]) => !isRealFirebaseValue(value))
  .map(([name]) => name);

export const firebaseEnabled = missingFirebaseEnv.length === 0;

const app = firebaseEnabled
  ? getApps()[0] ?? initializeApp(firebaseConfig)
  : null;

export const db = app ? getFirestore(app) : null;
export const auth = app ? getAuth(app) : null;

export async function ensureAnonymousUser() {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  try {
    return (await signInAnonymously(auth)).user;
  } catch (error) {
    if (
      error instanceof Error &&
      ("code" in error && error.code === "auth/configuration-not-found")
    ) {
      throw new Error(
        "Firebase Authentication이 아직 준비되지 않았습니다. Firebase Console에서 Authentication을 시작하고 익명 로그인 제공업체를 사용 설정해 주세요.",
      );
    }
    if (
      error instanceof Error &&
      ("code" in error && error.code === "auth/operation-not-allowed")
    ) {
      throw new Error(
        "Firebase 익명 로그인이 비활성화되어 있습니다. Authentication > 로그인 방법에서 익명 로그인을 사용 설정해 주세요.",
      );
    }
    throw error;
  }
}

export async function findClassByCode(code: string) {
  if (!db) return null;
  const result = await getDocs(
    query(collection(db, "classes"), where("code", "==", code.toUpperCase()), limit(1)),
  );
  return result.empty ? null : { id: result.docs[0].id, ...result.docs[0].data() };
}

export async function classCodeExists(code: string) {
  return Boolean(await findClassByCode(code));
}

export const refs = {
  class: (classId: string) => doc(db!, "classes", classId),
  teams: (classId: string) => collection(db!, "classes", classId, "teams"),
  team: (classId: string, teamId: string) =>
    doc(db!, "classes", classId, "teams", teamId),
  members: (classId: string, teamId: string) =>
    collection(db!, "classes", classId, "teams", teamId, "members"),
  member: (classId: string, teamId: string, studentId: string) =>
    doc(db!, "classes", classId, "teams", teamId, "members", studentId),
  reports: (classId: string, teamId: string) =>
    collection(db!, "classes", classId, "teams", teamId, "reports"),
  report: (classId: string, teamId: string, studentId: string) =>
    doc(db!, "classes", classId, "teams", teamId, "reports", studentId),
};
