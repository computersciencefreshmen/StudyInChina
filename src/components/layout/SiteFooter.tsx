import Link from 'next/link'

export interface FooterLink {
  label: string
  href: string
  external?: boolean
  externalAriaLabel?: string
}

export interface FooterColumn {
  title: string
  links: FooterLink[]
}

export interface FooterCreator {
  label: string
  href: string
  prefix?: string
}

export interface SiteFooterProps {
  locale: string
  columns?: FooterColumn[]
  legalLinks?: FooterLink[]
  legalLabel?: string
  homeHref?: string
  brandName?: string
  brandMark?: string
  description?: string
  creator?: FooterCreator
  updatedLabel?: string
  disclaimer?: string
  copyright?: string
  year?: number
}

function FooterAnchor({ link }: { link: FooterLink }) {
  return (
    <Link
      href={link.href}
      target={link.external ? '_blank' : undefined}
      rel={link.external ? 'noreferrer' : undefined}
      aria-label={link.externalAriaLabel}
    >
      <span>{link.label}</span>
      {link.external ? <span className="atlas-footer__external" aria-hidden="true">↗</span> : null}
    </Link>
  )
}

export function SiteFooter({
  locale,
  columns = [],
  legalLinks = [],
  legalLabel = 'Legal',
  homeHref = '/',
  brandName = 'Study in China',
  brandMark = '中',
  description = 'An independent, source-led guide for international students exploring universities, programs and cities across China.',
  creator,
  updatedLabel,
  disclaimer = 'Always confirm deadlines, fees and requirements on the official university website before applying.',
  copyright,
  year = new Date().getFullYear(),
}: SiteFooterProps) {
  return (
    <footer className="atlas-footer" lang={locale}>
      <div className="atlas-footer__horizon" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="atlas-container atlas-footer__grid">
        <div className="atlas-footer__intro">
          <Link className="atlas-footer__brand" href={homeHref}>
            <span className="atlas-footer__seal" aria-hidden="true">{brandMark}</span>
            <strong>{brandName}</strong>
          </Link>
          <p>{description}</p>
          {creator ? (
            <p className="atlas-footer__creator">
              {creator.prefix ? <span>{creator.prefix} </span> : null}
              <Link href={creator.href} target="_blank" rel="noreferrer">
                {creator.label}<span aria-hidden="true"> ↗</span>
              </Link>
            </p>
          ) : null}
        </div>

        {columns.map((column) => (
          <section className="atlas-footer__column" key={column.title}>
            <h2>{column.title}</h2>
            <ul>
              {column.links.map((link) => (
                <li key={`${link.href}-${link.label}`}><FooterAnchor link={link} /></li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="atlas-container atlas-footer__notice">
        <span className="atlas-footer__notice-mark" aria-hidden="true">i</span>
        <p>{disclaimer}</p>
      </div>

      <div className="atlas-container atlas-footer__base">
        <div>
          <span>{copyright ?? `© ${year} ${brandName}`}</span>
          {updatedLabel ? <span className="atlas-footer__updated">{updatedLabel}</span> : null}
        </div>
        {legalLinks.length > 0 ? (
          <nav aria-label={legalLabel}>
            <ul>
              {legalLinks.map((link) => (
                <li key={`${link.href}-${link.label}`}><FooterAnchor link={link} /></li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </footer>
  )
}
