import type { Metadata } from 'next';
import './globals.css';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'ECS Pre-Trip Travel Request',
  description: 'ECS-native pre-trip travel approval prototype',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
