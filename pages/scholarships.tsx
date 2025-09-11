import { useState } from 'react'
import Nav from '../components/Nav'

export default function Scholarships(){
  const [lang, setLang] = useState<'en'|'zh'|'ru'>('zh')
  const t = (en:string, zh:string, ru?:string) => lang==='en'? en: (lang==='zh'? zh: (ru??en))
  return (
    <>
      <Nav lang={lang} setLang={setLang} />
      <main className="container">
        <section className="section">
          <h2>{t('China Government Scholarship (CSC)','中国政府奖学金（CSC）','Гос. стипендия Китая (CSC)')}</h2>
          <p className="muted" style={{marginTop:8}}>
            {t(
              'Covers tuition, accommodation, stipend, and insurance. Annual calls usually Dec–Apr. Apply via CampusChina portal and the target university.',
              '覆盖学费、住宿、生活费、保险。每年12–4月为主申请季。通过“留学中国网”及目标高校渠道申请。',
              'Покрывает обучение, проживание, стипендию и медстраховку. Сезон набора обычно декабрь—апрель. Подача через портал CampusChina и университет.'
            )}
          </p>
          <ul>
            <li>{t('Eligibility: non-Chinese citizens in good health; degree-specific criteria apply.','基本条件：非中国籍、身心健康；学位阶段另有要求。','Требования: иностранный гражданин, здоровье; критерии зависят от степени.')}</li>
            <li>{t('Process: Choose university → Get agency code → Submit online → Mail docs if required → Track result.', '流程：选校→获取受理机构代码→网上报名→（如需）寄送材料→等待结果。','Процесс: выбор вуза → код агентства → онлайн-заявка → (если нужно) отправка бумаг → ожидание.')}</li>
            <li>{t('Tip: Prepare early (translations, recommendation letters, research plan).','提示：提早准备材料（翻译/公证、推荐信、学习计划等）。','Совет: готовьте заранее переводы/заверения, рекомендации, учебный план.')}</li>
          </ul>
          <div className="row" style={{marginTop:10}}>
            <a className="btn" href="https://www.campuschina.org/" target="_blank" rel="noopener noreferrer">{t('CSC Official Info','CSC官方信息','Официально о CSC')}</a>
            <a className="btn primary" href="https://studyinchina.csc.edu.cn/" target="_blank" rel="noopener noreferrer">{t('Apply on CampusChina','前往留学中国网申请','Подать на CampusChina')}</a>
          </div>
        </section>
      </main>
    </>
  )
}
