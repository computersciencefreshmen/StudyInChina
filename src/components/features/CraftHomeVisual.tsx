import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import styles from './CraftHomeVisual.module.css'

type Labels = { universities: string; programs: string; cities: string; guides: string; search: string; searchPlaceholder: string }
type Counts = { universities: number; programs: number; cities: number; guides: number }

function CampusDrawing() {
  return <svg viewBox="0 0 420 180" fill="none" aria-hidden="true" focusable="false">
    <circle cx="326" cy="44" r="25" fill="currentColor" opacity=".08" />
    <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M27 151H394M43 158H378M91 147V66H331V147M82 66H340L317 47H106L82 66ZM119 47L142 28H283L306 47M211 15V28M203 20H219" />
      <path d="M106 75H316M106 138H316M119 77V136M143 77V136M168 77V136M254 77V136M280 77V136M305 77V136M191 138V112C191 85 231 85 231 112V138M201 138V111M221 138V111" />
      <path d="M55 148V97H90M331 97H371V148M48 97H97L73 79L48 97ZM326 97H378L352 79L326 97ZM66 110H78V138H66ZM346 110H359V138H346Z" />
      <path d="M31 149V124M21 120C10 103 25 93 36 103C48 91 61 111 46 120C48 131 28 139 21 120ZM391 149V125M377 120C369 104 386 98 394 104C410 97 418 121 402 125C391 137 379 130 377 120Z" />
      <path d="M177 149H246M171 155H251M124 56H298M153 36H273" opacity=".45" />
    </g>
    <path d="m349 21 3-8 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="currentColor" opacity=".45" />
  </svg>
}

function NoteIcon({ kind }: { kind: 'programs' | 'cities' | 'guides' }) {
  return <svg viewBox="0 0 80 52" fill="none" aria-hidden="true" focusable="false"><g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'programs' ? <><path d="M15 10H62V44H15V10ZM22 10V44M29 18H54M29 25H51M29 32H43" /><path d="m52 2 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4L46.5 7.5l4-1.5L52 2Z" /></> : null}
    {kind === 'cities' ? <><path d="M10 43H69M16 42V23H31V42M31 42V11H49V42M49 42V28H63V42M21 29H25M21 35H25M37 18H42M37 25H42M37 32H42M54 34H58" /><circle cx="62" cy="12" r="5" /></> : null}
    {kind === 'guides' ? <path d="M13 12C26 9 33 12 40 17C47 12 56 9 67 12V42C56 39 47 41 40 45C33 41 23 39 13 42V12ZM40 17V45M20 21C26 20 29 21 33 23M20 28C26 27 29 28 33 30M47 23C51 21 56 20 60 21M47 30C51 28 56 27 60 28" /> : null}
  </g></svg>
}

/** Original decorative planning collage; every visible control has a real route. */
export function CraftHomeVisual({ locale, labels, counts }: { locale: LaunchLocale; labels: Labels; counts: Counts }) {
  return <div className={styles.collage}>
    <div className={styles.bluePaper} aria-hidden="true" /><div className={styles.paperShadow} aria-hidden="true" />
    <svg className={styles.routeDrawing} viewBox="0 0 1100 430" fill="none" aria-hidden="true" focusable="false"><path d="M74 115C131 65 241 71 285 124S232 239 162 262C113 279 119 351 193 369S409 355 411 304M705 101C772 45 960 73 1002 152S984 308 913 354" stroke="currentColor" strokeWidth="1.4" strokeDasharray="4 7" /><circle cx="75" cy="115" r="5" fill="currentColor" /><circle cx="913" cy="354" r="5" fill="currentColor" /><path d="m58 48 5-14 5 14 14 5-14 5-5 14-5-14-14-5 14-5ZM1040 287l4-11 4 11 11 4-11 4-4 11-4-11-11-4 11-4Z" fill="currentColor" /></svg>
    <div className={styles.planner}>
      <form action={`/${locale}/programs`} method="get" className={styles.search} role="search">
        <label className="atlas-sr-only" htmlFor="craft-home-search">{labels.searchPlaceholder}</label>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" /><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        <input id="craft-home-search" type="search" name="q" placeholder={labels.searchPlaceholder} /><button type="submit" aria-label={labels.search}>↗</button>
      </form>
      <div className={styles.campus}><CampusDrawing /></div>
      <Link className={styles.universityLink} href={`/${locale}/universities`}><span>{labels.universities}</span><span>{counts.universities.toLocaleString(locale)} <i aria-hidden="true">↗</i></span></Link>
    </div>
    <Link className={`${styles.note} ${styles.programNote}`} href={`/${locale}/programs`}><NoteIcon kind="programs" /><span>{labels.programs}</span><small>{counts.programs.toLocaleString(locale)} <i aria-hidden="true">↗</i></small></Link>
    <Link className={`${styles.note} ${styles.guideNote}`} href={`/${locale}/guides`}><NoteIcon kind="guides" /><span>{labels.guides}</span><small>{counts.guides.toLocaleString(locale)} <i aria-hidden="true">↗</i></small></Link>
    <Link className={`${styles.note} ${styles.cityNote}`} href={`/${locale}/cities`}><NoteIcon kind="cities" /><span>{labels.cities}</span><small>{counts.cities.toLocaleString(locale)} <i aria-hidden="true">↗</i></small></Link>
  </div>
}
