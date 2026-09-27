import { resolve } from 'node:path';
import { Store } from '../server/store.js';

const store = new Store(resolve('data/showme.sqlite'));
const report = store.validationReport();
console.log('ShowMe local validation signals (all workspaces in this database)');
console.table(report);
console.log('These are usage counts, not evidence of task correctness or customer demand.');
