import { tokens } from '@antler/alert-ui/tokens'
import type { Lang } from '@antler/schema'
import { recordText, type RecordView } from '@antler/trip'
import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

// 共有用の SSR ページ `GET /t/:id`（docs/specs/record/functional.md R7・R8、threat.md）。
// JS なしで読める記録と OG の meta。スクリプトを持たない（CSP で禁止）。文字は hono/html の自動エスケープを通す。
// 色は tokens.json（trip テーマ。B の導線は night）だけ。alert-danger は使わない。

export type RecordPageUrls = {
  /** この記録の公開 URL（PUBLIC_API_URL + /t/{id}） */
  page: string
  /** OG 画像の公開 URL */
  ogImage: string
  /** sim の A-7（操作できる画面） */
  app: string
  /** sim の A-1 */
  plan: string
  /** PWA（B-0） */
  pwa: string
}

/** SSR ページの CSP（threat.md SEC-2） */
export const RECORD_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/** 3 状態の色（alert-* / on-alert-*）は出さない（このページで使わない。alert-danger は鹿検知専用） */
function cssVars(theme: 'trip' | 'night', prefix = ''): string {
  return Object.entries(tokens.color[theme])
    .filter(([name]) => !/(^|-)alert-/.test(name))
    .map(([name, value]) => `--${prefix}${name}:${value};`)
    .join('')
}

const STYLE = `
:root{${cssVars('trip')}${cssVars('night', 'n-')}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:${tokens.font.sans};font-size:14px;line-height:24px}
a{color:var(--spruce)}
header{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:14px 24px;border-bottom:1px solid var(--line)}
.brand{font-weight:700;font-size:16px;letter-spacing:.04em;display:flex;align-items:center;gap:8px}
.url{margin-left:auto;font-family:${tokens.font.mono};font-size:13px;color:var(--ink-muted);word-break:break-all}
main{max-width:1360px;margin:0 auto;padding:40px 24px 48px;display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start}
.col{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:24px}
aside{flex:1 1 320px;max-width:420px;display:flex;flex-direction:column;gap:16px}
.eyebrow{font-size:12px;line-height:16px;font-weight:700;letter-spacing:.12em;color:var(--spruce)}
h1{margin:8px 0 0;font-size:32px;line-height:42px;font-weight:900}
.subtitle{margin:4px 0 0;font-size:20px;line-height:28px;font-weight:900}
.lead{margin:8px 0 0;color:var(--ink-muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.stat dt{font-size:12px;line-height:18px;color:var(--ink-muted)}
.stat dd{margin:0;font-family:${tokens.font.mono};font-weight:600;font-size:24px;line-height:28px}
.stat dd small{font-size:.4em;margin-left:2px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:22px 24px;display:flex;flex-direction:column;gap:12px}
h2{margin:0;font-size:16px;line-height:24px;font-weight:700}
.kept{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;list-style:none;margin:0;padding:0}
.photo{height:110px;border-radius:10px;background:var(--photo-placeholder);color:var(--ink-muted);display:flex;align-items:center;justify-content:center;font-size:12px}
.kept b{display:block;font-size:13px;line-height:18px;margin-top:8px}
.kept span{font-size:12px;line-height:18px;color:var(--ink-muted)}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.log li{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--ground);font-size:13px}
.when{font-family:${tokens.font.mono};font-size:12px;color:var(--ink-muted);min-width:90px}
.what{flex:1 1 200px}
.brake{font-family:${tokens.font.mono};font-size:12px}
.tone-avoided{font-weight:700;color:var(--spruce)}
.tone-closeCall,.tone-collided{font-weight:700;color:var(--clay-deep)}
.empty{color:var(--ink-muted);margin:0}
.shiori .row{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:20px}
.shiori .row svg{flex:none;margin-top:1px}
.shiori small{display:block;color:var(--ink-muted);font-size:12px}
.chip{font-family:${tokens.font.mono};font-size:12px;color:var(--spruce)}
.off{font-size:12px;color:var(--clay-deep);font-weight:700}
.b{background:var(--n-surface);color:var(--n-ink);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:12px}
.b p,.b ul{margin:0;font-size:12px;line-height:20px;color:var(--n-ink-muted)}
.b ul{padding-left:18px}
.b a{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;background:var(--n-spruce);color:var(--n-on-spruce);font-weight:700;text-decoration:none}
.links{display:flex;flex-wrap:wrap;gap:10px}
.links a{flex:1 1 140px;display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;font-weight:700;text-decoration:none;padding:0 12px;text-align:center}
.primary{background:var(--spruce);color:var(--on-spruce)}
.secondary{border:1px solid var(--ink-faint);background:var(--surface);color:var(--ink)}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.notfound{max-width:560px;margin:80px auto;padding:0 24px;display:flex;flex-direction:column;gap:16px}
`

function markSvg(result: RecordView['shiori']['rows'][number]['result']): Html {
  if (result === 'completed') {
    return html`<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="9"
        fill="none"
        stroke="${tokens.color.trip.spruce}"
        stroke-width="2"
      />
      <path
        d="M6 10.5l3 3 5-6"
        fill="none"
        stroke="${tokens.color.trip.spruce}"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>`
  }
  if (result === 'collided') {
    return html`<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="${tokens.color.trip['clay-deep']}"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </svg>`
  }
  return html`<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path
      d="M5 10h10"
      stroke="${tokens.color.trip['ink-faint']}"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>`
}

/** 文書全体（head と body）。テンプレートは 1 つで閉じる（整形で要素の閉じが動かないように） */
function documentOf(lang: Lang, title: string, meta: Html, body: Html): Html {
  return html`<!doctype html>
    <html lang="${lang === 'zh' ? 'zh-Hant' : lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="strict-origin" />
        <title>${title}</title>
        ${meta}
        <style>
          ${raw(STYLE)}
        </style>
      </head>
      <body>
        ${body}
      </body>
    </html>`
}

export function renderRecordPage(view: RecordView, urls: RecordPageUrls): Html {
  const t = (key: Parameters<typeof recordText>[0], values?: Record<string, string | number>) =>
    recordText(key, view.lang, values)
  const pageTitle = t('pageTitle', { title: view.title })
  const description = `${view.heading} ${view.stats.map((s) => `${s.label} ${s.value}${s.unit}`).join(' ・ ')}`
  const meta = html`<meta name="description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${view.title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${urls.page}" />
    <meta property="og:image" content="${urls.ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${pageTitle}" />
    <meta name="twitter:card" content="summary_large_image" />`

  const body = html`<header>
      <span class="brand">${t('brand')}</span>
      <span class="url"><span class="sr-only">${t('urlLabel')}: </span>${urls.page}</span>
    </header>
    <main>
      <div class="col">
        <div>
          <div class="eyebrow">${view.eyebrow}</div>
          <h1>${view.heading}</h1>
          <p class="subtitle">${view.title}</p>
          <p class="lead">${view.summary}</p>
        </div>
        <dl class="stats" aria-label="${t('statsLabel')}">
          ${view.stats.map(
            (s) =>
              html`<div class="stat">
                <dt>${s.label}</dt>
                <dd>${s.value}${s.unit ? html`<small>${s.unit}</small>` : ''}</dd>
              </div>`,
          )}
        </dl>
        <section class="card" aria-labelledby="kept-h">
          <h2 id="kept-h">${view.keptHeading}</h2>
          ${
            view.kept.length === 0
              ? html`<p class="empty">${view.keptEmpty}</p>`
              : html`<ul class="kept">
                  ${view.kept.map(
                    (k) =>
                      html`<li>
                        <div class="photo">${t('photoPending')}</div>
                        <b>${k.dayLabel} ${k.name}</b><span>${k.note}</span>
                      </li>`,
                  )}
                </ul>`
          }
        </section>
        <section class="card log" aria-labelledby="log-h">
          <h2 id="log-h">${view.logHeading}</h2>
          ${
            view.log.length === 0
              ? html`<p class="empty">${view.logEmpty}</p>`
              : html`<ol>
                  ${view.log.map(
                    (l) =>
                      html`<li>
                        <span class="when">${l.when}</span><span class="what">${l.what}</span
                        ><span class="brake">${l.brake}</span
                        ><span class="tone-${l.tone}">${l.outcomeLabel}</span>
                      </li>`,
                  )}
                </ol>`
          }
        </section>
      </div>
      <aside>
        <section class="card shiori" aria-labelledby="shiori-h">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <h2 id="shiori-h">${view.shiori.heading}</h2>
            <span class="chip">${view.shiori.statusLabel}</span>
          </div>
          <p class="subtitle" style="font-size:18px;margin:0">${view.title}</p>
          <ol>
            ${view.shiori.rows.map(
              (r) =>
                html`<li class="row">
                  ${markSvg(r.result)}<span
                    >${r.title}
                    <span class="off"
                      >${r.alertOff ? t('alertOff') : ''}${r.offChallenge ?? ''}</span
                    ><small>${r.resultLabel}${r.detail ? html` ・ ${r.detail}` : ''}</small></span
                  >
                </li>`,
            )}
          </ol>
        </section>
        <section class="b" aria-labelledby="b-h">
          <h2 id="b-h">${t('bHeading')}</h2>
          <p>${t('bBody')}</p>
          <ul>
            <li>${t('bPoint1')}</li>
            <li>${t('bPoint2')}</li>
            <li>${t('bPoint3')}</li>
          </ul>
          <a href="${urls.pwa}">${t('bLink')} →</a>
        </section>
        <nav class="links">
          <a class="primary" href="${urls.app}">${t('openInApp')}</a>
          <a class="secondary" href="${urls.plan}">${t('planOwn')}</a>
        </nav>
      </aside>
    </main>`
  return documentOf(view.lang, pageTitle, meta, body)
}

/** 無い・削除済みの記録。旅が無いので言語が分からず、4 言語を並べる（#9） */
export function renderNotFoundPage(planUrl: string): Html {
  const langs: Lang[] = ['ja', 'en', 'zh', 'ko']
  const body = html`<main class="notfound">
    <span class="brand">${recordText('brand', 'ja')}</span>
    <h1 style="font-size:20px;line-height:28px">${recordText('notFound', 'ja')}</h1>
    ${langs
      .slice(1)
      .map(
        (l) =>
          html`<p lang="${l === 'zh' ? 'zh-Hant' : l}" class="empty">
            ${recordText('notFound', l)}
          </p>`,
      )}
    <nav class="links">
      <a class="primary" href="${planUrl}"
        >${recordText('planOwn', 'ja')} / ${recordText('planOwn', 'en')}</a
      >
    </nav>
  </main>`
  return documentOf('ja', recordText('brand', 'ja'), html``, body)
}
