import type { Lang } from '@antler/schema'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { browserLang } from '@/shared/utils/browser-lang'
import { logger } from '@/shared/utils/logger'
import { APP_ERROR_TEXT, errorLangOrder } from './app-text'

/** `lang` 属性（zh は繁体字） */
const htmlLang = (lang: Lang): string => (lang === 'zh' ? 'zh-Hant' : lang)

type Props = { children: ReactNode }
type State = { failed: boolean }

/** 描画中の例外を受け止めて logger に記録し、利用者にはスタックトレースを見せない。 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('react.render', error, { componentStack: info.componentStack })
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert">
          {errorLangOrder(browserLang()).map((lang) => (
            <p key={lang} lang={htmlLang(lang)}>
              {APP_ERROR_TEXT[lang]}
            </p>
          ))}
        </div>
      )
    }
    return this.props.children
  }
}
