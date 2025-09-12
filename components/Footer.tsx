import type { Lang } from '../lib/i18n'

export default function Footer({ lang = 'en' as Lang }: { lang?: Lang }){
  const text = () => {
    switch (lang) {
      case 'zh':
        return {
          created: '为 Elizabeth 的留学之旅用心打造',
          updated: '最后更新：2025年9月',
        }
      case 'ru':
        return {
          created: 'Сделано с ❤️ для учебного пути Элизабет',
          updated: 'Последнее обновление: Сентябрь 2025',
        }
      default:
        return {
          created: "Created with ❤️ for Elizabeth's study abroad journey",
          updated: 'Last updated: September 2025',
        }
    }
  }
  const t = text()
  return (
    <footer className="container">
      <div className="footer text-slate-600">
        <div>{t.created}</div>
        <div className="mt-1 text-slate-500">{t.updated}</div>
      </div>
    </footer>
  )
}
