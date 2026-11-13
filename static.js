// 靜態版資料層：以前 /api/xxx 是當場運算，現在改讀 GitHub 主機算好的快照（經 /snap/<名稱> 登入後取得）。
// 前端各頁照舊呼叫 api('/api/…')，這裡把請求對應到快照；找不到對應就丟出說明。
// 對照表跟 scripts/snapshot.mjs 輸出的檔名一一對應。
const mem = new Map(); // 名稱 → { t, p }
async function snap(key, ttl = 60e3) {
  const c = mem.get(key);
  if (c && Date.now() - c.t < ttl) return c.p;
  const p = (async () => {
    const r = await fetch('/snap/' + key, { credentials: 'same-origin' });
    if (r.status === 401) { const e = new Error('未登入'); e.unauth = true; throw e; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `讀取失敗 ${r.status}`);
    return j;
  })();
  mem.set(key, { t: Date.now(), p });
  p.catch(() => mem.delete(key)); // 失敗不要快取
  return p;
}
const pickKeys = (all, keys) => Object.fromEntries(keys.filter((k) => all && k in all).map((k) => [k, all[k]]));
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export async function staticApi(path) {
  const u = new URL(path, location.origin);
  const name = u.pathname.replace(/^\/api\//, '');
  const q = Object.fromEntries(u.searchParams);
  switch (name) {
    case 'crypto': return snap('crypto');
    case 'twstock': return snap('twstock');
    case 'log': return snap(q.strat ? 'logstrat' : 'log');
    case 'xchg': // 前端分兩批（每批 60 個幣）要，快照是一整份：第一批給全部，其他批給空的，合併後不會重複
      return list(q.bases).includes('BTC') ? snap('xchg') : { updatedAt: Date.now(), status: {}, byBase: {}, hist: {} };
    case 'twhist': {
      if (q.cs) return snap('cs');
      if (q.fp) return snap('fp');
      if (q.pat) {
        if (q.market === 'crypto') {
          if (q.list) return snap('pat_crypto_list');
          const all = await snap('pat_crypto_' + (q.tf || '4h'));
          return { results: pickKeys(all.results, list(q.symbols)), miss: [], tf: all.tf };
        }
        if (q.plain) { // 單獨查一檔（沒有型態也要給圖）：讀每天收盤後算好的全台股分片
          const cs = list(q.codes), res = {}; let day = '';
          for (const sh of [...new Set(cs.map((c) => c.slice(0, 2)))]) {
            const all = await snap('pp_tw_' + sh, 10 * 60e3).catch(() => null); // 這個分片不存在＝那段代號沒有股票
            if (all) { day = all.day || day; Object.assign(res, pickKeys(all.results, cs)); }
          }
          return { results: res, miss: [], day };
        }
        const all = await snap('pat_tw');
        return { results: pickKeys(all.results, list(q.codes)), miss: [], day: all.day };
      }
      return pickKeys(await snap('twhist'), list(q.codes));
    }
    case 'vegas': {
      if (q.list) return snap('vegas_list_' + q.list);
      if (q.chart) {
        const d = (await snap(`vc_${q.m}_${String(q.s).replace(/[^A-Za-z0-9]/g, '_')}`).catch(() => null))?.[q.tf];
        if (!d) throw new Error('這檔的圖還沒有（快照只含清單內的股票／幣）');
        return d;
      }
      return pickKeys(await snap('vegas_scan_' + q.m), list(q.s));
    }
    case 'avgtrade': {
      const c = (await snap('avgtrade'))?.[q.from];
      if (!c) throw new Error('這個星期的成交資料還沒有');
      return c;
    }
    case 'pkdiv': return snap('pp_pkdiv', 10 * 60e3); // 大單推升的頂背離標記（每天收盤後算，放 snap2 分支）
    case 's6u': return snap('s6_u', 10 * 60e3); // 長期核心策略（價值＋低波動＋趨勢）每日名單，放 snap3 分支
    default: throw new Error('靜態版沒有這個資料：' + name);
  }
}

export async function snapStatus() { try { return await snap('_status', 30e3); } catch { return null; } }
