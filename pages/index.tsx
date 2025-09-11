import { useState } from 'react'
import Nav from '../components/Nav'
import Link from 'next/link'

export default function Home() {
  const [lang, setLang] = useState<'en'|'zh'|'ru'>('zh')
  const t = (en:string, zh:string, ru?:string) => lang==='en'? en: (lang==='zh'? zh: (ru??en))
  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container">
        <section className="section" style={{marginBottom:16}}>
          <h2>{t("Welcome","欢迎","Добро пожаловать")}</h2>
          <p className="muted">
            {t(
              "A focused guide for humanities majors (Translation / International Relations) with HSK3–4 pathways (foundation/Chinese language first) and direct HSK4+ options.",
              "面向人文学科（翻译/国际关系）的留学选校指南，强调HSK3–4可行路径（先预科/语言再升本）与HSK4+直接入读方案。",
              "Путеводитель по гуманитарным направлениям (перевод/международные отношения) с вариантами HSK3–4 (подготовительное/язык) и прямым поступлением с HSK4+."
            )}
          </p>
          <div className="row" style={{marginTop:8}}>
            <Link className="btn" href="/universities">{t('Explore Universities','浏览大学','Смотреть университеты')}</Link>
            <Link className="btn" href="/scholarships">{t('CSC Scholarship','中国政府奖学金','Гос. стипендия КНР (CSC)')}</Link>
          </div>
        </section>

        <section className="section">
          <h2>{t('Quick Notes','要点速览','Коротко')}</h2>
          <ul>
            <li>{t('Most Chinese-taught IR/Translation need HSK4–5; foundation year allows transition.', '中文授课国际关系/翻译通常需HSK4–5；不足可通过预科/语言过渡。','IR/перевод по-китайски обычно требуют HSK4–5; подготовительное/язык помогает перейти.')}</li>
            <li>{t('Prefer universities with strong language schools for smoother transition.', '优先选择语言学院成熟的高校，过渡更顺畅。','Выбирайте вузы с сильными языковыми школами — переход проще.')}</li>
            <li>{t('You can add more schools later; data is expandable.', '后续可持续补充更多院校，数据可扩展。','Список легко расширять новыми вузами.')}</li>
          </ul>
        </section>

        <div className="footer">{t('Last updated:','最后更新：','Последнее обновление:')} 2025-09 · {t('Built for Elizabeth','为Elizabeth定制','Для Elizabeth')}</div>
      </main>
    </>
  )
}
