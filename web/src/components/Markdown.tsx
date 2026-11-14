import { Fragment, type ReactNode } from 'react';

/**
 * The small Markdown subset problem texts use: paragraphs, `inline code`, ```code blocks```, **bold**,
 * *italic* and - / 1. lists. It builds React elements and never HTML strings, so anything else in the
 * text (including <script> or raw HTML) is shown as plain, escaped text: sanitised by construction.
 * shortcut: no links, headings or tables (no problem uses them); switch to a full parser if content needs them.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className ? `md ${className}` : 'md'}>{blocks(text)}</div>;
}

/** Inline-only rendering, for one-line text such as a hint. */
export function InlineMarkdown({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

function blocks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{inline(para.join(' '))}</p>);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]);
      out.push(
        <pre key={out.length}>
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }
    const item = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = !item[1];
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(lines[i]);
        if (!m || !m[1] !== ordered) break; // a different list kind starts a new list
        items.push(m[3]);
        i++;
      }
      i--;
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={out.length}>
          {items.map((t, j) => (
            <li key={j}>{inline(t)}</li>
          ))}
        </List>
      );
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  return out;
}

/** `code` first (its content is literal), then **bold** and *italic* in the remaining text. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={i}>{emphasis(part)}</Fragment>
      )
    );
}

function emphasis(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}
