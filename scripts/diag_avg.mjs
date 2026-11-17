// 診斷：GitHub 主機連櫃買／證交所的實際速度（臨時檔，確認後刪除）
const T=async(label,url,to=60000)=>{const t=Date.now();try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (whale-radar)',Accept:'application/json'},signal:AbortSignal.timeout(to)});const b=await r.text();console.log(label,'HTTP',r.status,'bytes',b.length,'ms',Date.now()-t);}catch(e){console.log(label,'ERR',e.message,'ms',Date.now()-t);}};
for(const ymd of ['20261113','20261116','20261117']){
  for(let i=0;i<3;i++) await T(`TPEx ${ymd} #${i+1}`,`https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=${ymd.slice(0,4)}%2F${ymd.slice(4,6)}%2F${ymd.slice(6,8)}&type=EW&response=json`);
  await T(`TWSE ${ymd}`,`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`);
}
