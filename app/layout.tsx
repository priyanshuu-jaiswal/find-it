import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FindIt - Campus Lost & Found',
  description: 'Multi-tenant campus Lost-and-Found platform featuring deterministic matching and private claims.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
