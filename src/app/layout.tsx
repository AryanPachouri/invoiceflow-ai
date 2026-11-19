import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";
import { themeBootScript } from "@/lib/theme-script";

export const metadata: Metadata = {
  title: { default: "InvoiceFlow AI", template: "%s · InvoiceFlow AI" },
  description: "Intelligent Accounts Payable Automation: from invoice PDF to an explained decision.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The boot script sets the theme class before hydration, so React must not warn about it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">
        <ToastProvider>
          <Sidebar />
          <main className="lg:pl-60">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
