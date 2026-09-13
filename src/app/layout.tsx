import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { serverEnv } from "@/lib/env";
import { COMPANY } from "@/lib/marketing/company";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "ClientTurn — Turn more leads into clients";
const description =
  "Instant Meta and Google lead follow-up, deterministic qualification and booking for UK B2B companies — agencies, web studios, SaaS and ecommerce. Reply in seconds, qualify automatically, book the next step.";

export const metadata: Metadata = {
  metadataBase: new URL(serverEnv.siteUrl),
  title: { default: title, template: "%s | ClientTurn" },
  description,
  keywords: [
    "lead follow-up software",
    "lead qualification software",
    "Meta lead ads follow-up",
    "AI lead management",
    "instant lead response",
    "lead conversion software",
    "sales qualification automation",
    "B2B lead management UK",
  ],
  applicationName: "ClientTurn",
  authors: [{ name: COMPANY.registeredName, url: serverEnv.siteUrl }],
  creator: COMPANY.registeredName,
  publisher: COMPANY.registeredName,
  category: "Business Software",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icon.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  manifest: "/site.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "ClientTurn",
    title,
    description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0B1020",
  colorScheme: "dark",
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ClientTurn",
  legalName: COMPANY.registeredName,
  url: serverEnv.siteUrl,
  logo: `${serverEnv.siteUrl}/dark_background_logo.png`,
  description,
  email: COMPANY.supportEmail,
  address: {
    "@type": "PostalAddress",
    streetAddress: "61 Bridge Street",
    addressLocality: "Kington",
    addressRegion: "Herefordshire",
    postalCode: "HR5 3DJ",
    addressCountry: "GB",
  },
  foundingDate: "2025-05-29",
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "ClientTurn",
  url: serverEnv.siteUrl,
  publisher: { "@type": "Organization", name: "ClientTurn" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </body>
    </html>
  );
}
