import Link from 'next/link'

import type { PublicLocale } from '@/i18n/config'

import { cx } from './cx'

export interface LanguageOption {
  code: PublicLocale
  label: string
  href: string
  active?: boolean
}

export interface LanguageSwitcherProps {
  languages: LanguageOption[]
  label?: string
  className?: string
  compact?: boolean
}

export function LanguageSwitcher({
  languages,
  label = 'Language',
  className,
  compact = false,
}: LanguageSwitcherProps) {
  const activeLanguage = languages.find((language) => language.active) ?? languages[0]

  if (!activeLanguage) return null

  return (
    <details className={cx('atlas-language-switcher', compact && 'atlas-language-switcher--compact', className)}>
      <summary aria-label={`${label}: ${activeLanguage.label}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.4 3.4 5.4 3.4 9S14.2 18.6 12 21c-2.2-2.4-3.4-5.4-3.4-9S9.8 5.4 12 3Z" />
        </svg>
        <span className="atlas-language-switcher__active">{activeLanguage.label}</span>
        <svg className="atlas-language-switcher__chevron" viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </summary>
      <ul aria-label={label} data-label={label}>
        {languages.map((language) => (
          <li key={language.code}>
            <Link
              href={language.href}
              hrefLang={language.code}
              lang={language.code}
              aria-current={language.active ? 'page' : undefined}
              className={cx(language.active && 'is-active')}
            >
              <span>{language.label}</span>
              <span className="atlas-language-switcher__code">{language.code.toUpperCase()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}
