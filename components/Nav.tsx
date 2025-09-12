import Link from 'next/link'
import { useRouter } from 'next/router'
import type { Lang } from '../lib/i18n'

export default function Nav({ lang, setLang }: { lang: Lang, setLang: (l:Lang)=>void }) {
  const router = useRouter()
  const path = router.pathname
  const t = (en: string, zh: string, ru: string) => lang === 'en' ? en : (lang==='zh'? zh : ru)

  return (
    <nav className="nav container">
      <div className="brand">
        <span className="badge">StudyCN</span>
        <div>Elizabeth’s Study in China Guide</div>
      </div>
      <div className="tabs">
        <Link className={"tab" + (path === '/' ? ' active' : '')} href="/">{t('Home','首页','Главная')}</Link>
        <Link className={"tab" + (path === '/universities' ? ' active' : '')} href="/universities">{t('Universities','大学','Университеты')}</Link>
        <Link className={"tab" + (path === '/scholarships' ? ' active' : '')} href="/scholarships">{t('Scholarships','奖学金','Стипендии')}</Link>
        <Link className={"tab" + (path === '/programs' ? ' active' : '')} href="/programs">{t('Programs','专业','Программы')}</Link>
        <Link className={"tab" + (path === '/guide' ? ' active' : '')} href="/guide">{t('Guide','指南','Путеводитель')}</Link>
      </div>
      <div className="lang">
        <button className={lang==='en'? 'active':''} onClick={()=>setLang('en')}>EN</button>
        <button className={lang==='zh'? 'active':''} onClick={()=>setLang('zh')}>中文</button>
        <button className={lang==='ru'? 'active':''} onClick={()=>setLang('ru')}>RU</button>
      </div>
    </nav>
  )
}
