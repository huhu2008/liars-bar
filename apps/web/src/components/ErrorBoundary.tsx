import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 兜底错误边界。
 * 3D chunk 加载失败、设备不支持 WebGL2、运行时异常 —— 之前这些都会让
 * React 卸载整棵树，玩家只看到一片黑，不知道发生了什么。
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; info: string }
> {
  state: { error: Error | null; info: string } = { error: null, info: '' };

  static getDerivedStateFromError(error: Error) {
    return { error, info: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 留一份到控制台，方便用户反馈时截屏
    console.error('[liars-bar] 渲染出错', error, info.componentStack);
    this.setState({ info: (info.componentStack ?? '').slice(0, 400) });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const isChunk = /chunk|dynamically imported|Loading chunk/i.test(error.message);
    return (
      <div className="grid min-h-full w-full place-items-center bg-[#0d0805] p-6 text-amber-100/80">
        <div className="w-full max-w-md rounded-xl border border-amber-900/50 bg-black/60 p-6 text-center">
          <div className="mb-3 font-display text-lg text-brass-400">
            {isChunk ? '资源没加载下来' : '出了点问题'}
          </div>
          <p className="mb-1 text-[12px] leading-relaxed text-amber-100/55">
            {isChunk
              ? '可能是网络不稳，或者浏览器不支持 WebGL。刷新一下通常就好了。'
              : '这个界面没能渲染出来。刷新可以重来一局。'}
          </p>
          <p className="mb-4 break-words text-[11px] leading-snug text-red-300/60">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-lg border border-brass-500/50 bg-brass-500/15 px-4 py-2 text-[12px] text-brass-300 transition-colors hover:bg-brass-500/25"
          >
            刷新重试
          </button>
          {info && (
            <details className="mt-3 text-left">
              <summary className="cursor-pointer text-[10px] text-amber-200/30">技术细节</summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[9px] leading-tight text-amber-200/25">
                {info}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
