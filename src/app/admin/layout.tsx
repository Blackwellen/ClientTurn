import * as React from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Platform operations · Client Turn",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
