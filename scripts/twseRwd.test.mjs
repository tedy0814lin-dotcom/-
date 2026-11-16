import assert from 'node:assert/strict';
import { parseRwd, latestRwd, rwdCandidates } from '../lib/twseRwd.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const mkMi = (ymd, rows, title) => ({ stat: 'OK', tables: [{ title: 'x' }, { title: title || `115年${ymd.slice(4, 6)}月${ymd.slice(6)}日 每日收盤行情(全部(不含權證、牛熊證、可展延牛熊證))`, fields: ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價'], data: rows }] });
const mkBw = (ymd, rows) => ({ stat: 'OK', date: ymd, fields: ['證券代號', '證券名稱', '收盤價', '殖利率(%)', '股利年度', '本益比', '股價淨值比', '財報年/季'], data: rows });
const miRows = [['2330', '台積電', '1', '1', '1,234,567', '1', '1', '1', '2,350.00'], ['00625K', 'X', '0', '0', '0', '--', '--', '--', '--']];
const bwRows = [['2330', '台積電', '2,350.00', '0.94', 114, '23.92', '8.71', '115/3'], ['1213', '大飲', '6.40', '0.00', 114, '-', '0.60', '115/3']];
for (let i = 0; i < 1100; i++) { miRows.push([String(3000 + i), 'n' + i, '1', '1', '100', '1', '1', '1', '10.00']); bwRows.push([String(3000 + i), 'n' + i, '10', '1.5', 114, '12.0', '1.2', '115/3']); }

// 轉換：逗號、'--'→空、殖利率 0→空、民國日期
const r = parseRwd(mkMi('20261113', miRows), mkBw('20261113', bwRows), '20261113');
eq(r.dayAll[0], { Date: '1151113', Code: '2330', Name: '台積電', ClosingPrice: '2,350.00', TradeValue: '1,234,567' }, '收盤行情對齊 openapi 格式');
eq(r.dayAll[1].ClosingPrice, '', '--→空'); eq(r.dayAll[1].TradeValue, '0');
eq(r.bw[0], { Date: '1151113', Code: '2330', Name: '台積電', PEratio: '23.92', PBratio: '8.71', DividendYield: '0.94' });
eq(r.bw[1].PEratio, '', 'PE "-"→空'); eq(r.bw[1].DividendYield, '', '殖利率 0.00→空（對齊 openapi）');
// 防呆
assert.throws(() => parseRwd(mkMi('20261113', miRows), mkBw('20261112', bwRows), '20261113'), /日期不符/); n++;
assert.throws(() => parseRwd(mkMi('20261112', miRows), mkBw('20261113', bwRows), '20261113'), /日期不符/); n++;
assert.throws(() => parseRwd(mkMi('20261113', miRows.slice(0, 50)), mkBw('20261113', bwRows), '20261113'), /筆數太少/); n++;
assert.throws(() => parseRwd({ stat: '很抱歉，沒有符合條件的資料!' }, mkBw('20261113', bwRows), '20261113'), /無資料/); n++;

// 候選日：週末跳過、只留比 openapi 新的、今天 14:30 前不試
eq(rwdCandidates('2026-11-17', 14 * 60 + 40, '2026-11-13'), ['20261117', '20261116'], '週二下午：今天＋週一');
eq(rwdCandidates('2026-11-17', 10 * 60, '2026-11-13'), ['20261116'], '週二早上不試今天');
eq(rwdCandidates('2026-11-17', 20 * 60, '2026-11-17'), [], 'openapi 已是今天');
eq(rwdCandidates('2026-11-14', 20 * 60, '2026-11-13'), [], '週六無交易日');

// latestRwd：由新到舊，第一個完整的
const calls = [];
const fetchJ = async (u) => { calls.push(u); const d = u.match(/date=(\d+)/)[1]; if (d === '20261117') return { stat: '很抱歉，沒有符合條件的資料!' }; return u.includes('MI_INDEX') ? mkMi(d, miRows) : mkBw(d, bwRows); };
const got = await latestRwd(['20261117', '20261116'], fetchJ);
eq(got.ymd, '20261116'); ok(calls.length === 3, '今天沒資料就只試 MI_INDEX 一次');
eq(await latestRwd(['20261117'], fetchJ), null);
console.log(`twseRwd.test: ${n} 項通過`);
