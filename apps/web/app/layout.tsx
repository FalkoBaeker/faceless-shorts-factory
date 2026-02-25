import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Faceless Shorts Factory',
  description: 'Mobile-first wizard flow for faceless short-form video production.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
