# 一次性：用 FinMind 抓每檔月營收歷史（匿名額度約 300 次/小時，每 13 秒一檔），存到 revdata 分支 raw/<code>.json
import requests,json,os,time,subprocess,sys
codes=json.load(open('scripts/rev_codes.json')); os.makedirs('raw',exist_ok=True); n=0; t0=time.time()
def push():
    subprocess.run('git add raw && (git diff --cached --quiet || git commit -qm "rev data" ) && git push -q origin HEAD:revdata',shell=True)
for c in codes:
    p=f'raw/{c}.json'
    if os.path.exists(p): continue
    for k in range(40):
        if time.time()-t0>5.4*3600: push(); print('time up'); sys.exit(0)
        try:
            r=requests.get('https://api.finmindtrade.com/api/v4/data',params=dict(dataset='TaiwanStockMonthRevenue',data_id=c,start_date='2008-01-01'),timeout=40); j=r.json()
            if r.status_code==200 and j.get('status')==200: json.dump(j['data'],open(p,'w')); n+=1; time.sleep(13); break
            print('blk',c,r.status_code,flush=True); time.sleep(600)
        except Exception as e: print('ERR',repr(e)[:80],flush=True); time.sleep(60)
    if n and n%60==0: push()
push(); print('DONE',n)
