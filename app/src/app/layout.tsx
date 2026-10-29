import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dotnote",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var k="dotnote-theme";var d=document.documentElement;function sys(){return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}function apply(mode){var r=mode==="system"?sys():mode;d.classList.toggle("dark",r==="dark");d.style.colorScheme=r;}try{var s=localStorage.getItem(k);var m=s==="light"||s==="dark"||s==="system"?s:"system";apply(m);}catch(e){apply("system");}})();`,
          }}
        />
      </head>
      <body className="h-dvh overflow-hidden antialiased">{children}</body>
    </html>
  );
}
