import type { AppProps } from 'next/app'
import '../styles.css'
import { Inter } from 'next/font/google'
import { LanguageProvider } from '../lib/lang'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <div className={inter.variable}>
      <LanguageProvider>
        <Component {...pageProps} />
      </LanguageProvider>
    </div>
  )
}
