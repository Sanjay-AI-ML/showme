import { readFileSync, writeFileSync } from 'node:fs';

for (const [source, target, exportName] of [
  ['widget.css', 'widget-style.ts', 'widgetCss'],
  ['audio-processor.js', 'audio-worklet-source.ts', 'audioWorkletSource'],
]) {
  const contents = readFileSync(new URL(`../sdk/${source}`, import.meta.url), 'utf8');
  writeFileSync(new URL(`../sdk/${target}`, import.meta.url),
    `// Generated from ${source} so the widget works in another app's bundler.\nexport const ${exportName} = ${JSON.stringify(contents)};\n`);
}
