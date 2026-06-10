import { Component } from 'react'

/**
 * 通用错误边界。
 * 渲染期一旦抛出异常（如流式输出过程中的「半截 markdown」让 react-markdown 崩溃），
 * 在此拦截并展示降级 UI，避免整棵 React 树被卸载导致整页白屏。
 *
 * 用法：
 *   <ErrorBoundary resetKey={activeId} fallback={...}>
 *     <可能崩溃的子树 />
 *   </ErrorBoundary>
 *
 * resetKey 变化时（如切换会话）自动清除错误状态，重新尝试渲染子树。
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prevProps) {
    // resetKey 变化时清除错误，给子树一次重新渲染的机会
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error, info) {
    // 保留控制台日志，便于定位是哪条消息 / 哪段 markdown 触发的崩溃
    console.error('[ErrorBoundary] 渲染期异常已拦截：', error, info)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({ error: this.state.error, reset: this.handleReset })
          : this.props.fallback
      }
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            这部分内容渲染出错了，但不影响其它对话。
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
