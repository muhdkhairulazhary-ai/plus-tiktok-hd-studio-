"""Generate reproducible synthetic fixtures and measured A/B/C/D reports, locally only.
Usage: python3 tools/make-ab-fixtures.py /tmp/NEW_EMPTY_STUDY_DIRECTORY
Run from repository root. Native libx265, AAC, Node and Python required.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
summarize_only=sys.argv[2:]==['--summarize']
if not summarize_only and any(root.iterdir()): raise SystemExit('Study directory must be empty')
summary={'scope':'Synthetic local fixtures; no physical iPhone or TikTok results','fixtures':{}}
for kind,rate,channels in [('sdr',44100,1),('hlg',48000,2),('hdr10',32000,2),('priming',48000,2),('vfr',44100,1)]:
    hdr=kind in ('hlg','hdr10'); transfer={'hlg':'arib-std-b67','hdr10':'smpte2084'}.get(kind,'bt709')
    prim='bt2020' if hdr else 'bt709'; matrix='bt2020nc' if hdr else 'bt709'
    params=f'pools=1:frame-threads=1:log-level=error:colorprim={prim}:transfer={transfer}:colormatrix={matrix}:keyint=30'
    if kind=='hdr10': params+=':master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400'
    extra=['-vf',"select='not(mod(n,2))+not(mod(n,5))'",'-fps_mode','vfr','-bf','0'] if kind=='vfr' else []
    src=root/(kind+'.mov'); rotated=root/(kind+'-rotated.mov')
    if not summarize_only:
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=60000/1001','-itsoffset','0' if kind=='priming' else '0.15','-f','lavfi','-i',f'sine=frequency=440:sample_rate={rate}',
            '-t','13' if kind=='sdr' else '1',*extra,'-c:v','libx265','-preset','ultrafast','-x265-params',params,'-pix_fmt','yuv420p10le' if hdr else 'yuv420p','-color_primaries',prim,'-color_trc',transfer,'-colorspace',matrix,'-tag:v','hvc1','-c:a','aac','-ac',str(channels),str(src)],check=True)
        subprocess.run(['ffmpeg','-v','error','-display_rotation:v:0','90','-i',str(src),'-map','0','-c','copy',str(rotated)],check=True)
        subprocess.run(['node','tools/mp4-ab.mjs',str(rotated),str(root/kind)],check=True)
    r=json.loads((root/kind/'comparison.json').read_text()); evidence={}
    for name,v in r['variants'].items():
        evidence[name]={k:v[k] for k in ['bytes','sha256','structure','source_timing_errors','native_seeks','native_seek_matches_source']}
        evidence[name]['validation']=v.get('validation')
        evidence[name]['physical_track_runs']=v['interleaving']['track_runs']
        evidence[name]['timeline']=v['interleaving']['timeline']
        evidence[name]['format_duration']=v['format_duration']
        evidence[name]['decoded_pcm']=v['decoded_pcm']
        evidence[name]['ordered_packet_hash_aggregates']={kind:{'count':len(ps),'sha256_of_ordered_sha256_strings':hashlib.sha256('\n'.join(p['data_hash'] for p in ps).encode()).hexdigest()} for kind in ['video','audio'] for ps in [[p for p in v['packets'] if p['codec_type']==kind]]}
        evidence[name]['decoded_video_frames']=v['native_playback']['decoded_video_frames']
        evidence[name]['decoded_frame_hash_aggregate']=v['native_playback']['decoded_frame_hash_aggregate']
        evidence[name]['all_frame_hdr_aggregate']=v['native_playback']['all_frame_hdr_aggregate']
        evidence[name]['stream_summary']=[{k:s[k] for k in ['codec_name','profile','time_base','r_frame_rate','avg_frame_rate','duration','sample_rate','channels','side_data_list'] if k in s} for s in v['streams']]
    summary['fixtures'][kind]={'ffmpeg_version':r['ffmpeg_version'],'variants':evidence}
(root/'measurements.json').write_text(json.dumps(summary,indent=2)+'\n')
print('Measured evidence:',root/'measurements.json')
