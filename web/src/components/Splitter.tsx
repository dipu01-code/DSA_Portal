import { useState, type RefObject } from 'react';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A pane size (fraction of the container, 0..1) remembered in localStorage across visits. */
export function useStoredSize(key: string, initial: number, min = 0.2, max = 0.8) {
  const [size, setSize] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved > 0 ? clamp(saved, min, max) : initial;
  });
  const update = (v: number) => {
    const next = clamp(v, min, max);
    setSize(next);
    localStorage.setItem(key, String(Math.round(next * 1000) / 1000));
  };
  return [size, update, min, max] as const;
}

/**
 * Draggable divider (WAI-ARIA window splitter): drag it, or focus it and use the arrow keys
 * (5% steps), Home and End. `value` is the first pane's share of `container`.
 * orientation="vertical" is a vertical line between left and right panes.
 */
export function Splitter(props: {
  label: string;
  orientation: 'vertical' | 'horizontal';
  container: RefObject<HTMLElement>;
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
}) {
  const vertical = props.orientation === 'vertical';
  const fromPointer = (e: React.PointerEvent) => {
    const r = props.container.current?.getBoundingClientRect();
    if (!r || !(vertical ? r.width : r.height)) return;
    props.onChange(vertical ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height);
  };
  return (
    <div
      role="separator"
      aria-label={props.label}
      aria-orientation={props.orientation}
      aria-valuenow={Math.round(props.value * 100)}
      aria-valuemin={Math.round(props.min * 100)}
      aria-valuemax={Math.round(props.max * 100)}
      tabIndex={0}
      className={`splitter ${props.orientation}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
      }}
      onKeyDown={(e) => {
        const step = 0.05;
        const next = {
          ArrowLeft: props.value - step,
          ArrowUp: props.value - step,
          ArrowRight: props.value + step,
          ArrowDown: props.value + step,
          Home: props.min,
          End: props.max,
        }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        props.onChange(next);
      }}
    />
  );
}
