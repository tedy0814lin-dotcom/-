// 分頁整理回歸測試：舊 wr_prefs 的每一種 tab 值都要落在正確位置；分組與導覽順序固定。
import assert from 'node:assert/strict';
import { migratePrefs, groupOf, SCAN_TABS, TOP_TABS } from '../lib/navPrefs.js';
let n = 0; const t = (name, fn) => { fn(); n++; };
// 1. 既有分頁原樣保留
for (const tab of ['crypto', 'tw', 'twpat', 'strat', 'log']) t('keep ' + tab, () => assert.equal(migratePrefs({ tab }).tab, tab));
// 2. 更舊的分頁併入策略
for (const tab of ['vegas', 'trust', 'claude']) t('old ' + tab, () => assert.equal(migratePrefs({ tab }).tab, 'strat'));
// 3. 無存檔／亂值 → 預設 crypto（與改版前相同）
for (const s of [undefined, null, {}, { tab: 'x' }, { tab: 123 }, 'abc', []]) t('default', () => assert.deepEqual(migratePrefs(s), { tab: 'crypto', scan: 'crypto' }));
// 4. 診斷頁未上線時存到 diag 要退回；上線後可用
t('diag off', () => assert.equal(migratePrefs({ tab: 'diag' }).tab, 'crypto'));
t('diag on', () => assert.equal(migratePrefs({ tab: 'diag' }, { diagReady: true }).tab, 'diag'));
// 5. 子分頁記憶：在策略頁時，市場掃描回到上次的子分頁
t('scan remembered', () => assert.deepEqual(migratePrefs({ tab: 'strat', scan: 'twpat' }), { tab: 'strat', scan: 'twpat' }));
t('scan invalid', () => assert.equal(migratePrefs({ tab: 'log', scan: 'zzz' }).scan, 'crypto'));
t('scan follows tab', () => assert.equal(migratePrefs({ tab: 'tw', scan: 'twpat' }).scan, 'tw'));
// 6. 分組與順序
for (const x of SCAN_TABS) t('group ' + x, () => assert.equal(groupOf(x), 'scan'));
for (const x of ['strat', 'diag', 'log']) t('group ' + x, () => assert.equal(groupOf(x), x));
t('order', () => assert.deepEqual(TOP_TABS, ['scan', 'strat', 'diag', 'log']));
t('scan tabs', () => assert.deepEqual(SCAN_TABS, ['crypto', 'tw', 'twpat']));
console.log('nav.test.mjs OK', n, 'cases');
