import { useState } from 'react';
import type { Problem } from '@dsa-portal/ui-core';
import { Icon } from './Icon';

/** JSON shown readable (compact where it fits); anything that isn't JSON as is. */
export const prettyJson = (s: string) => {
  try {
    return formatJson(JSON.parse(s));
  } catch {
    return s;
  }
};

const LINE = 60;
/** Like JSON.stringify(v, null, 2), but arrays/objects stay on one line when they fit: [2, 7, 11, 15]. */
export function formatJson(v: unknown, indent = ''): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? String(v);
  const inner = indent + '  ';
  const isArray = Array.isArray(v);
  const items = isArray
    ? v.map((x) => formatJson(x, inner))
    : Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${formatJson(x, inner)}`);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  const oneLine = `${open}${items.join(', ')}${close}`;
  if (!oneLine.includes('\n') && indent.length + oneLine.length <= LINE) return oneLine;
  return `${open}\n${items.map((i) => inner + i).join(',\n')}\n${indent}${close}`;
}

/** Example test cases as cards: separate Input and Output boxes, each with a copy button. */
export function Examples({ cases }: { cases: Problem['testCases'] }) {
  return (
    <div className="examples">
      {cases.map((t, i) => (
        <section key={i} className="example" aria-label={`Example ${i + 1}`}>
          <h3>Example {i + 1}</h3>
          <CopyBox label="Input" example={i + 1} value={t.input} />
          <CopyBox label="Output" example={i + 1} value={t.expected} />
        </section>
      ))}
    </div>
  );
}

function CopyBox({ label, example, value }: { label: string; example: number; value: string }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value); // the compact original, ready to paste into code
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="io-box">
      <div className="io-head">
        <span className="io-label">{label}</span>
        <span role="status" className="small muted">
          {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Copy failed' : ''}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Copy ${label.toLowerCase()} of example ${example}`}
          title="Copy"
          onClick={() => void copy()}
        >
          <Icon name={copied === 'yes' ? 'check' : 'copy'} />
        </button>
      </div>
      <pre>{prettyJson(value)}</pre>
    </div>
  );
}
