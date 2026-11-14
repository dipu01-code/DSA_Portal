import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './components/Markdown';

const html = (text: string) => render(<Markdown text={text} />).container.innerHTML;

describe('Markdown', () => {
  it('turns backticks into inline code', () => {
    const { container } = render(
      <Markdown text="There are `numCourses` courses, labeled 0 to `numCourses - 1`." />
    );
    const codes = [...container.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toEqual(['numCourses', 'numCourses - 1']);
    expect(container.textContent).not.toContain('`');
  });

  it('renders bold, italic, lists, paragraphs and code blocks', () => {
    const out = html(
      'A **bold** and *soft* word.\n\n- one\n- two\n\n1. first\n\n```\nlet x = 1;\n```'
    );
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>soft</em>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<ol><li>first</li></ol>');
    expect(out).toContain('<pre><code>let x = 1;</code></pre>');
  });

  it('is sanitised: HTML in the text stays text', () => {
    const out = html('<img src=x onerror="alert(1)"> and `<script>alert(1)</script>`');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;img');
    expect(out).toContain('<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>');
  });

  it('keeps markers inside code literal', () => {
    expect(html('`a * b * c` and `**x**`')).toContain('<code>a * b * c</code>');
  });
});
