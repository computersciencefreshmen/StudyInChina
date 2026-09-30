export const siteThemes = [
  { id: 'cloud', name: '云白淡紫', english: 'Cloud & Lilac', description: '柔和的云白、淡紫与薄荷绿。最接近你的参考图，轻盈、友好，适合长时间浏览。', accent: '#7860cf', background: '#f4f5f8', surface: '#ffffff', ink: '#252638', muted: '#686b80', soft: '#eee9fc', secondary: '#b9edce', border: '#e9e9f1', display: 'sans', tags: ['轻盈', '圆润', '推荐'] },
  { id: 'jade', name: '雾绿玉色', english: 'Jade Journal', description: '带一点东方气质的雾白与玉绿。克制、安静，让官方数据与阅读内容成为主角。', accent: '#277267', background: '#f2f6f2', surface: '#fdfefd', ink: '#233c36', muted: '#61746b', soft: '#e2efe7', secondary: '#e9d9a6', border: '#dde8e0', display: 'serif', tags: ['自然', '可信', '东方气质'] },
  { id: 'ocean', name: '冰川蓝', english: 'Ocean Studio', description: '清透的冰川蓝搭配深海文字。信息层级清楚，适合国际化教育平台和数据工作台。', accent: '#356bc0', background: '#f1f5fb', surface: '#ffffff', ink: '#1d3452', muted: '#66758c', soft: '#e4edff', secondary: '#bce7e9', border: '#e1e8f4', display: 'sans', tags: ['清透', '国际化', '专业'] },
  { id: 'sand', name: '暖白陶色', english: 'Warm Atelier', description: '暖白纸感与陶土色点缀。温暖、有编辑感，适合院校故事、城市指南与留学内容。', accent: '#a4513e', background: '#f8f4ef', surface: '#fffdf9', ink: '#40312d', muted: '#7b6e65', soft: '#f4e4db', secondary: '#d7e5bd', border: '#eae1d8', display: 'serif', tags: ['温暖', '人文', '杂志感'] },
  { id: 'night', name: '深夜墨绿', english: 'Night Observatory', description: '深墨色界面与柔亮的青绿。沉静、有力量，适合专注的数据核验和夜间使用。', accent: '#b0e0bb', background: '#151c1c', surface: '#202929', ink: '#e9f0eb', muted: '#a0b1a7', soft: '#2b4038', secondary: '#c3b6ed', border: '#34423e', display: 'sans', tags: ['专注', '深色', '数据感'] },
] as const
export type SiteTheme = typeof siteThemes[number]
// Shared with server layouts so the saved theme applies before hydration.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('studycn-theme');if(['cloud','jade','ocean','sand','night'].indexOf(t)>=0)document.documentElement.dataset.theme=t}catch(e){}})()`
export function themeVariables(theme: SiteTheme) {
  return {
    '--wb-accent': theme.accent, '--wb-background': theme.background,
    '--wb-surface': theme.surface, '--wb-ink': theme.ink, '--wb-muted': theme.muted,
    '--wb-soft': theme.soft, '--wb-secondary': theme.secondary, '--wb-border': theme.border,
  }
}
