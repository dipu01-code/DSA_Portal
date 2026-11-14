import { useRef, type ReactNode } from 'react';

/**
 * WAI-ARIA tabs: one Tab stop for the list (the selected tab), ←/→/Home/End move between tabs,
 * and each panel is labelled by its tab. Controlled: the parent keeps the selected id.
 */
export function Tabs<Id extends string>(props: {
  label: string;
  tabs: { id: Id; label: ReactNode }[];
  selected: Id;
  onSelect(id: Id): void;
  children: ReactNode; // the selected panel's content
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ids = props.tabs.map((t) => t.id);
  const move = (to: number) => {
    const id = ids[(to + ids.length) % ids.length];
    props.onSelect(id);
    refs.current[id]?.focus();
  };
  const at = ids.indexOf(props.selected);
  return (
    <>
      <div
        role="tablist"
        aria-label={props.label}
        className="tabs"
        onKeyDown={(e) => {
          const key = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: ids.length - 1 }[
            e.key
          ];
          if (key === undefined) return;
          e.preventDefault();
          move(key);
        }}
      >
        {props.tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => (refs.current[t.id] = el)}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === props.selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === props.selected ? 0 : -1}
            onClick={() => props.onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${props.selected}`}
        aria-labelledby={`tab-${props.selected}`}
        className="tab-panel"
      >
        {props.children}
      </div>
    </>
  );
}
