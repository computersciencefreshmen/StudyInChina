import type { AppProps } from 'next/app'
import '../styles.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <div className={inter.variable}>
      <Component {...pageProps} />
    </div>
  )
}
