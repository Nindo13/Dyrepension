import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Annisse Kattepension",
  description: "Luksuriøs, familiedrevet kattepension i Annisse",
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="da">
      <body className={`${inter.className} body-ocean`}>
        {children}
      </body>
    </html>
  );
}
