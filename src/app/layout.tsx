import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { AppearanceProvider } from "@/context/AppearanceContext";
import { DemoBanner } from "@/components/DemoBanner";
import { GlobalLayout } from "@/components/GlobalLayout";
import { EARLY_APPLY_SCRIPT } from "@/lib/appearance";
import { PRODUCT, COMPANY_TAGLINE } from "@/lib/brand";

const inter = Inter({
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: PRODUCT,
  description: COMPANY_TAGLINE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="signature"
      data-icons="classic"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground" suppressHydrationWarning>
        <DemoBanner />
        <AuthProvider>
          <AppearanceProvider>
            <GlobalLayout>{children}</GlobalLayout>
          </AppearanceProvider>
        </AuthProvider>
        <Script id="saved-look" strategy="beforeInteractive">
          {EARLY_APPLY_SCRIPT}
        </Script>
      </body>
    </html>
  );
}
