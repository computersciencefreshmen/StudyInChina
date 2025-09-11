import { useState } from 'react'
import Nav from '../components/Nav'

export default function Programs(){
  const [lang, setLang] = useState<'en'|'zh'|'ru'>('zh')
  const t = (en:string, zh:string, ru?:string) => lang==='en'? en: (lang==='zh'? zh: (ru??en))
  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container">
        <section className="section">
          <h2>{t('Programs','专业方向','Программы')}</h2>
          <p className="muted">{t('Coming soon: curated program-level pages for Translation/Interpreting and International Relations.','即将上线：翻译/口译与国际关系的项目级页面与课程清单。','Скоро: страницы по направлениям Перевод/Устный и МО.')}</p>
        </section>
      </main>
    </>
  )
}
