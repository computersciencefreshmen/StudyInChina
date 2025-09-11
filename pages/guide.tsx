import { useState } from 'react'
import Nav from '../components/Nav'

export default function Guide(){
  const [lang, setLang] = useState<'en'|'zh'|'ru'>('zh')
  const t = (en:string, zh:string, ru?:string) => lang==='en'? en: (lang==='zh'? zh: (ru??en))
  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container">
        <section className="section">
          <h2>{t('Application Guide','申请指南','Гид по поступлению')}</h2>
          <ol>
            <li>{t('Assess your current HSK (target HSK4–5 for humanities).','评估当前HSK（人文方向目标HSK4–5）。','Оцените ваш HSK (для гуманитариев целевой HSK4–5).')}</li>
            <li>{t('Pick schools that accept HSK3–4 with a foundation/Chinese year.','优先选择可HSK3–4“先过渡”的学校。','Выберите вузы, принимающие с HSK3–4 при условии подготовительного года/языка.')}</li>
            <li>{t('Prepare docs: passport, transcripts, HSK, personal statement, 2 references.','准备材料：护照、成绩单、HSK、个人陈述、两封推荐信。','Подготовьте паспорт, выписки, HSK, мотивационное письмо, 2 рекомендации.')}</li>
            <li>{t('Apply both to the university and (optionally) CSC.','同时向目标高校与（可选）CSC提交申请。','Подавайте и в университет, и (по желанию) на CSC.')}</li>
            <li>{t('Plan budget and timeline (Dec–Apr peak for scholarships).','规划预算与时间线（奖学金高峰12–4月）。','Спланируйте бюджет и сроки (гранты чаще дек.–апр.).')}</li>
          </ol>
        </section>
      </main>
    </>
  )
}
