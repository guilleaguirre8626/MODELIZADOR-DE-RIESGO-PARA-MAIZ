#!/usr/bin/env python3
import csv, json, math, sys, urllib.parse, urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

LAT=-31.40
LON=-63.53
STATION_ID=1
START='19810101'
END='20251231'
BASE='https://power.larc.nasa.gov/api/temporal/daily/point'
PARAMS='T2M_MAX,T2M_MIN,T2M,PRECTOTCORR,RH2M'
OUT=Path(__file__).resolve().parent/'generated'
OUT.mkdir(exist_ok=True)

FORTNIGHTS=[f'{m:02d}-{h}' for m in range(9,13) for h in (1,2)] + [f'{m:02d}-{h}' for m in range(1,4) for h in (1,2)]


def fetch_power():
    cache=OUT/'nasa_power_pilar_1981_2025.json'
    if cache.exists() and cache.stat().st_size>1000:
        return json.loads(cache.read_text(encoding='utf-8'))
    q=urllib.parse.urlencode({
        'parameters':PARAMS,'community':'AG','longitude':LON,'latitude':LAT,
        'start':START,'end':END,'format':'JSON','time-standard':'LST'
    })
    url=BASE+'?'+q
    print('Downloading NASA POWER daily series...')
    req=urllib.request.Request(url, headers={'User-Agent':'AgroClima/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw=r.read()
    cache.write_bytes(raw)
    return json.loads(raw.decode('utf-8'))


def load_campaigns():
    p=Path(__file__).resolve().parent/'campaigns.csv'
    rows=[]
    with p.open('r',encoding='utf-8-sig',newline='') as f:
        for r in csv.DictReader(f):
            rows.append({'start_year':int(r['start_year']),'phase':r['phase'],'label':r['label']})
    return rows


def parse_weather(js):
    par=js['properties']['parameter']
    keys=set()
    for v in par.values(): keys.update(v.keys())
    rows={}
    for k in sorted(keys):
        d=datetime.strptime(k,'%Y%m%d').date()
        def val(name):
            x=par.get(name,{}).get(k)
            if x is None or x <= -900: return None
            return float(x)
        rows[d]={'tmax':val('T2M_MAX'),'tmin':val('T2M_MIN'),'tmean':val('T2M'),'precip':val('PRECTOTCORR'),'rh':val('RH2M')}
    return rows


def campaign_date(start_year, month, day):
    y=start_year if month>=9 else start_year+1
    # clamp Feb 29 etc
    while True:
        try: return date(y,month,day)
        except ValueError: day-=1


def center_date(start_year,key):
    m=int(key[:2]); half=int(key[-1]); day=8 if half==1 else 23
    return campaign_date(start_year,m,day)


def window_rows(weather, center, before=15, after=15):
    out=[]
    d=center-timedelta(days=before)
    end=center+timedelta(days=after)
    while d<=end:
        if d in weather: out.append((d,weather[d]))
        d+=timedelta(days=1)
    return out


def consec_true(flags, n=3):
    run=0
    for x in flags:
        run = run+1 if x else 0
        if run>=n: return True
    return False


def max_dry_spell(rows, cutoff=1.0):
    run=best=0
    for _,r in rows:
        p=r['precip']
        dry=(p is not None and p<cutoff)
        run=run+1 if dry else 0
        best=max(best,run)
    return best


def event_metrics(rows):
    tmax=[r['tmax'] for _,r in rows if r['tmax'] is not None]
    tmin=[r['tmin'] for _,r in rows if r['tmin'] is not None]
    precip=[r['precip'] for _,r in rows if r['precip'] is not None]
    valid_temp=len(tmax)>=26 and len(tmin)>=26
    valid_p=len(precip)>=26
    heat_flags=[(r['tmax'] is not None and r['tmax']>=35) for _,r in rows]
    hotnight_flags=[(r['tmin'] is not None and r['tmin']>=22) for _,r in rows]
    return {
      'heat_any_ge35': (max(tmax)>=35) if valid_temp else None,
      'heatwave_3d_ge35': consec_true(heat_flags,3) if valid_temp else None,
      'hot_night_any_ge22': (max(tmin)>=22) if valid_temp else None,
      'hot_nights_3d_ge22': consec_true(hotnight_flags,3) if valid_temp else None,
      'cold_any_le4': (min(tmin)<=4) if valid_temp else None,
      'heavy_rain_any_ge50': (max(precip)>=50) if valid_p else None,
      'drought_proxy_p31_lt80': (sum(precip)<80) if valid_p else None,
      'excess_proxy_p31_gt180': (sum(precip)>180) if valid_p else None,
      'dry_spell_ge10d': (max_dry_spell(rows)>=10) if valid_p else None,
    }

METRIC_THRESHOLD={
 'heat_any_ge35':35,'heatwave_3d_ge35':35,'hot_night_any_ge22':22,'hot_nights_3d_ge22':22,
 'cold_any_le4':4,'heavy_rain_any_ge50':50,'drought_proxy_p31_lt80':80,'excess_proxy_p31_gt180':180,
 'dry_spell_ge10d':10
}


def extraterrestrial_radiation_mm(d, lat_deg):
    # FAO-56 Ra, converted from MJ m-2 d-1 to equivalent mm d-1 by 0.408.
    j=d.timetuple().tm_yday
    phi=math.radians(lat_deg)
    dr=1+0.033*math.cos(2*math.pi*j/365)
    delta=0.409*math.sin(2*math.pi*j/365-1.39)
    x=-math.tan(phi)*math.tan(delta)
    x=max(-1,min(1,x))
    ws=math.acos(x)
    gsc=0.0820
    ra_mj=(24*60/math.pi)*gsc*dr*(ws*math.sin(phi)*math.sin(delta)+math.cos(phi)*math.cos(delta)*math.sin(ws))
    return 0.408*ra_mj

def eto_hargreaves(d,tmean,tmax,tmin,lat_deg):
    if tmean is None or tmax is None or tmin is None: return None
    td=max(0,tmax-tmin)
    ra=extraterrestrial_radiation_mm(d,lat_deg)
    return max(0,0.0023*(tmean+17.8)*math.sqrt(td)*ra)

def write_daily(weather):
    p=OUT/'daily_weather_hydric.csv'
    with p.open('w',encoding='utf-8',newline='') as f:
        w=csv.writer(f); w.writerow(['station_id','date','tmax_c','tmin_c','tmean_c','precip_mm','rh_mean_pct','eto_mm','eto_method','source','quality_flag'])
        for d,r in sorted(weather.items()):
            eto=eto_hargreaves(d,r['tmean'],r['tmax'],r['tmin'],LAT); w.writerow([STATION_ID,d.isoformat(),r['tmax'],r['tmin'],r['tmean'],r['precip'],r['rh'],None if eto is None else round(eto,4),'FAO56 Hargreaves','NASA POWER','reanalysis/grid point'])
    return p


def write_daily_sql(weather):
    p=OUT/'daily_weather_hydric_upsert.sql'
    cols=['station_id','date','tmax_c','tmin_c','tmean_c','precip_mm','rh_mean_pct','eto_mm','eto_method','source','quality_flag']
    def q(x):
        if x is None: return 'null'
        if isinstance(x,(int,float)): return str(x)
        return "'"+str(x).replace("'","''")+"'"
    rows=[]
    for d,r in sorted(weather.items()):
        eto=eto_hargreaves(d,r['tmean'],r['tmax'],r['tmin'],LAT)
        rows.append([STATION_ID,d.isoformat(),r['tmax'],r['tmin'],r['tmean'],r['precip'],r['rh'],None if eto is None else round(eto,4),'FAO56 Hargreaves','NASA POWER','reanalysis/grid point'])
    with p.open('w',encoding='utf-8') as f:
        f.write('-- AgroClima daily weather + ETo Hargreaves 1981-2025\n')
        for i in range(0,len(rows),150):
            chunk=rows[i:i+150]
            f.write('insert into public.daily_weather ('+','.join(cols)+') values\n')
            f.write(',\n'.join('('+','.join(q(x) for x in row)+')' for row in chunk))
            f.write('\non conflict (station_id,date) do update set tmax_c=excluded.tmax_c,tmin_c=excluded.tmin_c,tmean_c=excluded.tmean_c,precip_mm=excluded.precip_mm,rh_mean_pct=excluded.rh_mean_pct,eto_mm=excluded.eto_mm,eto_method=excluded.eto_method,source=excluded.source,quality_flag=excluded.quality_flag;\n\n')
        f.write("select count(*) as daily_rows, min(date) as desde, max(date) as hasta, round(avg(eto_mm),2) as eto_media from public.daily_weather where station_id=1 and eto_mm is not null;\n")
    return p

def build_stats(weather,campaigns):
    accum={}
    detail=[]
    for c in campaigns:
        sy=c['start_year']; phase=c['phase']
        for key in FORTNIGHTS:
            center=center_date(sy,key)
            rows=window_rows(weather,center)
            metrics=event_metrics(rows)
            for metric,event in metrics.items():
                k=(phase,key,metric)
                accum.setdefault(k,{'events':0,'total':0})
                if event is not None:
                    accum[k]['total']+=1
                    accum[k]['events']+=1 if event else 0
                detail.append([sy,c['label'],phase,key,center.isoformat(),metric,'' if event is None else int(event)])
    out=[]
    for (phase,key,metric),a in sorted(accum.items()):
        prob=(a['events']/a['total']) if a['total'] else None
        out.append({
          'station_id':STATION_ID,'phase':phase,'fortnight':key,'metric':metric,
          'threshold':METRIC_THRESHOLD[metric],'event_campaigns':a['events'],'total_campaigns':a['total'],
          'probability':round(prob,6) if prob is not None else None,'period_start_year':min(c['start_year'] for c in campaigns),
          'period_end_year':max(c['start_year'] for c in campaigns),'source':'NASA POWER daily + campaign ENSO classifier from campaigns.csv'
        })
    return out,detail


def write_stats(rows,detail):
    p=OUT/'observed_risk_stats.csv'
    fields=['station_id','phase','fortnight','metric','threshold','event_campaigns','total_campaigns','probability','period_start_year','period_end_year','source']
    with p.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)
    d=OUT/'risk_events_by_campaign.csv'
    with d.open('w',encoding='utf-8',newline='') as f:
        w=csv.writer(f); w.writerow(['start_year','campaign','phase','fortnight','window_center','metric','event']); w.writerows(detail)
    return p,d


def sql_literal(x):
    if x is None or x=='': return 'null'
    if isinstance(x,(int,float)): return str(x)
    return "'"+str(x).replace("'","''")+"'"


def write_sql(rows):
    p=OUT/'observed_risk_stats_upsert.sql'
    cols=['station_id','phase','fortnight','metric','threshold','event_campaigns','total_campaigns','probability','period_start_year','period_end_year','source']
    with p.open('w',encoding='utf-8') as f:
        f.write('-- AgroClima observed risk statistics\n')
        f.write('delete from public.observed_risk_stats where station_id=1;\n\n')
        batch=200
        for i in range(0,len(rows),batch):
            chunk=rows[i:i+batch]
            f.write('insert into public.observed_risk_stats ('+','.join(cols)+') values\n')
            vals=[]
            for r in chunk: vals.append('('+','.join(sql_literal(r[c]) for c in cols)+')')
            f.write(',\n'.join(vals))
            f.write('\non conflict (station_id,phase,fortnight,metric,threshold) do update set event_campaigns=excluded.event_campaigns,total_campaigns=excluded.total_campaigns,probability=excluded.probability,period_start_year=excluded.period_start_year,period_end_year=excluded.period_end_year,source=excluded.source;\n\n')
        f.write("select phase, fortnight, metric, probability, event_campaigns, total_campaigns from public.observed_risk_stats order by phase, fortnight, metric;\n")
    return p


def write_app_view(rows):
    # Compatibility table matching the four AgroClima v2 risk dimensions.
    chosen={'heat':'heatwave_3d_ge35','cold':'cold_any_le4','drought':'drought_proxy_p31_lt80','excess':'excess_proxy_p31_gt180'}
    lookup={(r['phase'],r['fortnight'],r['metric']):r for r in rows}
    p=OUT/'app_risk_matrix.csv'
    with p.open('w',encoding='utf-8',newline='') as f:
        w=csv.writer(f); w.writerow(['phase','fortnight','p_heat','p_cold','p_drought','p_excess','n_campaigns','definition'])
        phases=sorted(set(r['phase'] for r in rows))
        for ph in phases:
            for key in FORTNIGHTS:
                rr=[lookup.get((ph,key,m)) for m in chosen.values()]
                if not all(rr): continue
                probs=[x['probability'] for x in rr]
                n=min(x['total_campaigns'] for x in rr)
                w.writerow([ph,key,*probs,n,'heat=3 consecutive Tmax>=35C; cold=any Tmin<=4C; drought=31d rain<80mm proxy; excess=31d rain>180mm proxy'])
    return p


def main():
    js=fetch_power(); weather=parse_weather(js); campaigns=load_campaigns()
    print('Daily rows:',len(weather),'Campaigns:',len(campaigns))
    daily=write_daily(weather); daily_sql=write_daily_sql(weather)
    rows,detail=build_stats(weather,campaigns)
    p,d=write_stats(rows,detail); s=write_sql(rows); a=write_app_view(rows)
    print('Generated:',daily,daily_sql,p,s,a)
    # basic validation
    assert len(rows)>100
    assert all(r['total_campaigns']>0 for r in rows)
    print('OK')

if __name__=='__main__': main()
