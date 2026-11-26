import {describe, it, expect} from 'vitest';
import {escapeHtml} from '../src/ui/safe';
import mainSource from '../src/main.ts?raw';

describe('DOM 注入防护(治理 1.3)', () => {
  it('转义文本上下文与属性上下文的全部危险字符', () => {
    expect(escapeHtml('普通中文')).toBe('普通中文');
    expect(escapeHtml('プレイヤー')).toBe('プレイヤー');
    expect(escapeHtml('player" onfocus="alert(1)')).toBe('player&quot; onfocus=&quot;alert(1)');
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml("<script>alert('x')</script>")).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
    expect(escapeHtml('a&b<c>d')).toBe('a&amp;b&lt;c&gt;d');
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('')).toBe('');
  });

  it('转义输出在文本与双引号属性上下文都不产生新节点或属性边界', () => {
    const evil = '"><img src=x onerror=window.__pwned=1>';
    const attr = `value="${escapeHtml(evil)}"`;
    // 属性不会被提前闭合
    expect(attr.startsWith('value="')).toBe(true);
    expect(attr.includes('"><img')).toBe(false);
    // 文本不会被解析为标签
    const text = `<td>${escapeHtml(evil)}</td>`;
    expect(text.includes('<img')).toBe(false);
  });

  it('main.ts 中选手名/设计名的模板插值均已过 escapeHtml(源码扫描守卫)', () => {
    const source: string = mainSource;
    // 危险模式:用户可控字段直接插值(前一个字符不是 esc( 调用的结尾)
    const patterns = [/\$\{([a-zA-Z_.]*?player\.name)\}/g, /\$\{([a-zA-Z_.]*?playerName)\}/g, /\$\{flightDesign!?\.(name)\}/g, /<h2>\$\{design\.name\}/g];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const start = match.index ?? 0;
        const lineStart = source.lastIndexOf('\n', start) + 1;
        const lineEnd = source.indexOf('\n', start);
        const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        // canvas fillText 按文本渲染,无需转义,以显式标记豁免
        if (line.includes('canvas-text:')) continue;
        const before = source.slice(Math.max(0, start - 12), start);
        expect(/escapeHtml\([^)]*\)$/.test(before.trim()) || before.endsWith('escapeHtml('), `未转义插值: ${match[0]} 上下文: …${before}`).toBe(true);
      }
    }
  });
});
