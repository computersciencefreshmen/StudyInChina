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
      <div className="mx-auto max-w-xl mt-8">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 text-center">
          <div className="text-slate-700 font-medium">{t.created}</div>
          <div className="mt-1 text-slate-500 text-sm">{t.updated}</div>
        </div>
      </div>
    </footer>
  )
}
