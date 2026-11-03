import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@/shared/utils/logger'

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
          <p>表示中に問題が起きました。ページを読み込み直してください。</p>
        </div>
      )
    }
    return this.props.children
  }
}
