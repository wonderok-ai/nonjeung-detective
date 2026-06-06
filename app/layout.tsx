import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "논증 탐정단",
  description: "중학교 국어 실시간 협동 논증 게임",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
