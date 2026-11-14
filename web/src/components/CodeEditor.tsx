import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Bundle Monaco instead of loading it from a CDN: works offline and under the desktop app's strict CSP.
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker(),
};
loader.config({ monaco });

export function CodeEditor(props: {
  value: string;
  onChange(v: string): void;
  dark: boolean;
  fontSize: number;
  onRun(): void;
}) {
  return (
    <Editor
      height="100%"
      language="javascript"
      theme={props.dark ? 'vs-dark' : 'vs'}
      value={props.value}
      onChange={(v) => props.onChange(v ?? '')}
      options={{
        fontSize: props.fontSize,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        ariaLabel: 'Code editor',
      }}
      onMount={(editor) => {
        // Ctrl/Cmd+Enter runs the visible tests even while the editor has focus.
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => props.onRun());
      }}
    />
  );
}
