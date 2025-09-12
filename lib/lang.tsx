import React, { useContext, useEffect, useState } from 'react'
import type { Lang } from './i18n'

type Ctx = { lang: Lang; setLang: (l: Lang)=>void }
const LanguageContext = React.createContext<Ctx | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }){
  const [lang, setLang] = useState<Lang>('en')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('lang') as Lang | null
    if (saved && (saved === 'en' || saved === 'zh' || saved === 'ru')) {
      setLang(saved)
    }
  }, [])

  const update = (l: Lang) => {
    setLang(l)
    if (typeof window !== 'undefined') window.localStorage.setItem('lang', l)
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang: update }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(){
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}

