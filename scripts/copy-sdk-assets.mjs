import { copyFileSync } from 'node:fs';

copyFileSync('sdk/widget.css', 'sdk/dist/widget.css');
copyFileSync('sdk/audio-processor.js', 'sdk/dist/audio-processor.js');
