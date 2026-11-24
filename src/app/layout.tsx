import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, Noto_Sans_Telugu } from "next/font/google";
import "./globals.css";
import "./hydro.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

const telugu = Noto_Sans_Telugu({
  subsets: ["telugu"],
  variable: "--font-telugu",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HYDRO AI — Multiple Minds. One Intelligence.",
  description:
    "HYDRO AI is a hybrid distributed intelligence: specialist models coordinated by the HYDRA-FLOW controller, with claim-level verification and consent-based memory.",
  applicationName: "HYDRO AI",
};

export const viewport: Viewport = {
  themeColor: "#05070A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} ${telugu.variable}`}>
      <body
        style={
          {
            "--font-telugu-stack": "var(--font-telugu), var(--font-inter), sans-serif",
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
