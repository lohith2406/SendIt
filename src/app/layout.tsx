// src/app/layout.tsx
import '../styles/globals.css'
import { ReactNode } from 'react'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'SendIt – P2P File Sharing',
  description: 'Share large files instantly with peer-to-peer WebRTC',
}


export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className + ' bg-gray-50 min-h-screen'}>
        {children}
      </body>
    </html>
  )
}
