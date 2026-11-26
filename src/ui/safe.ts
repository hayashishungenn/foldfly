/**
 * 用户输入 → HTML 的安全插值(治理阶段 1.3)。
 *
 * 约定:所有进入 innerHTML 模板字符串的用户可控字符串(选手名、自定义
 * 设计名、任何未来引入的自由文本)必须经过 escapeHtml。该实现同时适用
 * 于文本上下文与双引号属性上下文(转义 & < > " ' 五个字符),因此
 * value="${esc(name)}" 与 <td>${esc(name)}</td> 都是安全的。
 * 不依赖长度限制;Canvas 绘制文本(fillText)天然按文本渲染,无需转义。
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
