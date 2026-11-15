"""Independent offline container experiments. Never imported by the website.
Usage: python3 tools/kf-prototype.py SOURCE A_SMART D_SOURCE EMPTY_OUT [--audio-mutations]
N is sample-preserving. O/T/K are explicit audio-mutating diagnostics, never lossless claims.
"""
import copy
import hashlib
import json
import math
import struct
import subprocess
import sys
import tempfile
from fractions import Fraction
from pathlib import Path
from mp4_ab import (parse,one,child,tracks,serialize,replace,box,pack,u32,groups,timescale,
                    duration,edits,probe,verify,assert_source_boxes,playback,seek_checks,structure,interleaving,timing_measurements)

def node(kind,payload): return parse(box(kind,payload))[0]
def packet_list(audit,kind): return [p for p in audit['packets'] if p['codec_type']==kind]
def stream(audit,kind): return next(s for s in audit['streams'] if s['codec_type']==kind)
def checksum(data): return hashlib.sha256(data).hexdigest()
def desc(tag,data):
    if len(data)>=1<<28: raise ValueError('Descriptor too large')
    size=len(data); encoded=[size&127]; size>>=7
    while size: encoded.insert(0,(size&127)|128); size>>=7
    return bytes([tag,*encoded])+data

def asc_data(path):
    value=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_streams','-show_data','-of','json',str(path)]))['streams'][0]
    raw=b''.join(bytes.fromhex(line.split(':',1)[1].split('  ',1)[0]) for line in value['extradata'].splitlines() if ':' in line)
    expected=stream(probe(path),'audio')['extradata_hash'].split(':')[1].lower()
    if checksum(raw)!=expected: raise ValueError('ASC extraction hash mismatch')
    return raw

def canonical_aac(asc,rate,channels):
    rates=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350]
    if len(asc)<2: raise ValueError('Missing AAC configuration')
    index=((asc[0]&7)<<1)|(asc[1]>>7)
    if asc[0]>>3!=2 or index>=len(rates) or rates[index]!=rate or (asc[1]>>3)&15!=channels or channels not in (1,2) or rate>65535 or asc[1]&4:
        raise ValueError('Prototype requires ordinary 1024-sample AAC-LC mono/stereo, table rate <=65535 Hz')
    decoder=desc(4,b'\x40\x15'+bytes(11)+desc(5,asc))
    esds=box(b'esds',bytes(4)+desc(3,b'\x00\x01\x00'+decoder+desc(6,b'\x02')))
    entry=box(b'mp4a',bytes(6)+b'\x00\x01'+bytes(8)+struct.pack('>HHHHI',channels,16,0,0,rate<<16)+esds)
    return bytes(4)+pack(1)+entry

def set_duration(n,value):
    p=bytearray(n['payload']); v=p[0]
    if v not in (0,1): raise ValueError('Unsupported duration version')
    at=(28 if v else 20) if n['type']==b'tkhd' else (24 if v else 16)
    if value<0 or value>=1<<(64 if v else 32): raise ValueError('Duration overflow')
    struct.pack_into('>Q' if v else '>I',p,at,value);replace(n,bytes(p))

def audio_edit(track,entries):
    # Use v1 rather than truncating large signed media times/durations.
    payload=bytes([1,0,0,0])+pack(len(entries))+b''.join(struct.pack('>Qqhh',e['duration'],e['media_time'],*e['rate']) for e in entries)
    new=node(b'edts',box(b'elst',payload)); children=track['children']
    found=next((i for i,n in enumerate(children) if n['type']==b'edts'),None)
    if found is None: children.insert(next(i for i,n in enumerate(children) if n['type']==b'mdia'),new)
    else: children[found]=new

def tail_packets(rate,channels,asc,original_durations):
    if any(d!=1024 for d in original_durations): raise ValueError('Tail blocked: original AAC has shortened/non-1024 durations; join semantics not validated')
    with tempfile.TemporaryDirectory(prefix='studio-aac-tail-') as tmp:
        path=Path(tmp)/'silence.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',f'anullsrc=r={rate}:cl={"mono" if channels==1 else "stereo"}',
                        '-t','0.5','-c:a','aac','-b:a','128k',str(path)],check=True)
        if asc_data(path)!=asc: raise ValueError('Tail blocked: independently encoded AAC configuration does not match source')
        data=path.read_bytes(); ps=probe(path)['packets'][3:7]
        if len(ps)!=4 or any(int(p['duration'])!=1024 for p in ps): raise ValueError('Invalid generated AAC tail duration')
        return [data[int(p['pos']):int(p['pos'])+int(p['size'])] for p in ps]

def rebuild(base,dest,variant,asc,tails):
    if variant not in ('N','O','T','K'): raise ValueError('Unknown prototype variant')
    raw=base.read_bytes(); nodes=parse(raw); movie=one(nodes,b'moov'); ts=tracks(nodes); audit=probe(base)
    ftyp=one(nodes,b'ftyp')['raw']; packets={k:packet_list(audit,k) for k in ('video','audio')}
    chunks={'video':[],'audio':[]}; chunks_order=[]; payloads={}
    for kind,ps in packets.items():
        payloads[kind]=[raw[int(p['pos']):int(p['pos'])+int(p['size'])] for p in ps]
        if any(checksum(data)!=p['data_hash'].split(':')[1].lower() for data,p in zip(payloads[kind],ps)): raise ValueError('Source packet bounds/hash mismatch')
    events=[]
    for index,kind in enumerate(('video','audio')):
        ps=packets[kind]; clock=Fraction(stream(audit,kind)['time_base']); origin=int(ps[0]['dts'])
        for i,p in enumerate(ps): events.append(((int(p['dts'])-origin)*clock,index,i,kind))
    # Relative decode-time physical merge. Does not rewrite the actual sample timeline.
    for _,_,i,kind in sorted(events):
        if chunks_order and chunks_order[-1]['kind']==kind: chunks_order[-1]['samples'].append(i)
        else:
            c={'kind':kind,'samples':[i]}; chunks[kind].append(c);chunks_order.append(c)
    append=variant in ('T','K'); reset=variant in ('O','K')
    if append:
        if len(tails)!=4: raise ValueError('Exactly four real AAC tail packets required')
        c={'kind':'audio','samples':list(range(len(packets['audio']),len(packets['audio'])+4)),'tail':True}
        chunks['audio'].append(c); payloads['audio']+=tails
    for track,mdia,stbl,handler in ts:
        kind='video' if handler==b'vide' else 'audio'; cs=chunks[kind]; ps=payloads[kind]
        # One description; write run-length stsc for coalesced chunks.
        runs=[]
        for i,c in enumerate(cs):
            count=len(c['samples'])
            if not runs or count!=runs[-1][1]: runs.append((i+1,count,1))
        replace(child(stbl,b'stsc'),bytes(4)+pack(len(runs))+b''.join(pack(*r) for r in runs))
        replace(child(stbl,b'stco'),bytes(4)+pack(len(cs))+bytes(4*len(cs)))
        replace(child(stbl,b'stsz'),bytes(4)+pack(0,len(ps))+b''.join(pack(len(p)) for p in ps))
        if kind=='audio':
            replace(child(stbl,b'stsd'),canonical_aac(asc,int(stream(audit,kind)['sample_rate']),int(stream(audit,kind)['channels'])))
            if append:
                dt=child(stbl,b'stts'); runs=[(u32(r),u32(r,4)) for r in groups(dt['payload'],8)]
                if any(d!=1024 for _,d in runs): raise ValueError('Tail join requires full-duration AAC samples')
                runs[-1]=(runs[-1][0]+4,1024);replace(dt,bytes(4)+pack(len(runs))+b''.join(pack(*r) for r in runs))
                group=next((n for n in stbl['children'] if n['type']==b'sbgp'),None)
                if group is not None:
                    data=bytearray(group['payload'])
                    if data[:4]!=bytes(4) or data[4:8]!=b'roll' or len(data)!=12+u32(data,8)*8: raise ValueError('Unsupported audio recovery mapping')
                    if sum(u32(data,12+i*8) for i in range(u32(data,8)))!=len(packets[kind]): raise ValueError('Invalid recovery sample count')
                    at=len(data)-8;struct.pack_into('>I',data,at,u32(data,at)+4);replace(group,bytes(data))
                set_duration(child(mdia,b'mdhd'),duration(child(mdia,b'mdhd'))+4096)
            if reset or append:
                clock=timescale(child(movie,b'mvhd'));media_clock=timescale(child(mdia,b'mdhd')); existing=edits(track)
                if reset: existing=[];media_time=0
                else: media_time=next((e['media_time'] for e in existing if e['media_time']>=0),0)
                leading=[e for e in existing if e['media_time']==-1]
                length=math.ceil(Fraction((duration(child(mdia,b'mdhd'))-media_time)*clock,media_clock))
                audio_edit(track,leading+[{'duration':length,'media_time':media_time,'rate':[1,0]}])
                set_duration(child(track,b'tkhd'),sum(e['duration'] for e in edits(track)))
    if reset or append: set_duration(child(movie,b'mvhd'),max(duration(child(t,b'tkhd')) for t,_,_,_ in ts))
    header=serialize(movie); start=len(ftyp)+len(header)+8;cursor=start;main=[]
    for c in chunks_order:
        c['offset']=cursor
        for i in c['samples']:
            data=payloads[c['kind']][i];main.append(data);cursor+=len(data)
    if append:
        chunks['audio'][-1]['offset']=cursor+8  # a separate genuine media-data box, not free/padding
    for _,_,stbl,handler in ts:
        cs=chunks['video' if handler==b'vide' else 'audio']
        if any(c['offset']>0xffffffff for c in cs): raise ValueError('32-bit prototype offset overflow')
        replace(child(stbl,b'stco'),bytes(4)+pack(len(cs))+b''.join(pack(c['offset']) for c in cs))
    final=serialize(movie)
    if len(final)!=len(header): raise ValueError('Unstable metadata size')
    dest.write_bytes(ftyp+final+box(b'mdat',b''.join(main))+(box(b'mdat',b''.join(tails)) if append else b''))

def inspect_tables(path):
    raw=path.read_bytes(); nodes=parse(raw); movie=one(nodes,b'moov'); media=[n for n in nodes if n['type']==b'mdat']; report=[];ranges=[]
    audit=probe(path)
    for _,mdia,stbl,handler in tracks(nodes):
        kind='video' if handler==b'vide' else 'audio'; ps=packet_list(audit,kind)
        size=child(stbl,b'stsz')['payload'];count=u32(size,8)
        sizes=[u32(size,4)]*count if u32(size,4) else [u32(size,12+i*4) for i in range(count)]
        if count!=len(ps): raise AssertionError('Not all raw samples exposed exactly once')
        descs=child(stbl,b'stsd')['payload'];assert u32(descs,4)==1,'Extra sample description'
        entries=[tuple(u32(r,i*4) for i in range(3)) for r in groups(child(stbl,b'stsc')['payload'],12)]
        offsets=[u32(r) for r in groups(child(stbl,b'stco')['payload'],4)];index=0;mapping=0
        if not entries or entries[0][0]!=1 or any(x[0]>=y[0] for x,y in zip(entries,entries[1:])): raise AssertionError('Bad chunk mapping')
        for chunk,offset in enumerate(offsets,1):
            while mapping+1<len(entries) and chunk>=entries[mapping+1][0]:mapping+=1
            _,n,description=entries[mapping]
            if n<=0 or description!=1:raise AssertionError('Invalid chunk sample description/count')
            for _ in range(n):
                if index>=count:raise AssertionError('Extra chunk samples')
                end=offset+sizes[index]
                if not any(offset>=m['start']+m['header'] and end<=m['start']+len(m['raw']) for m in media):raise AssertionError('Sample outside media')
                if int(ps[index]['pos'])!=offset or int(ps[index]['size'])!=sizes[index]:raise AssertionError('Table/FFprobe mapping mismatch')
                if checksum(raw[offset:end])!=ps[index]['data_hash'].split(':')[1].lower():raise AssertionError('Table/hash disagreement')
                ranges.append((offset,end));offset=end;index+=1
        if index!=count:raise AssertionError('Unmapped sample')
        durations=[(u32(r),u32(r,4)) for r in groups(child(stbl,b'stts')['payload'],8)]
        if sum(c for c,_ in durations)!=count or any(d<=0 for _,d in durations):raise AssertionError('Invalid decode durations')
        if sum(c*d for c,d in durations)!=duration(child(mdia,b'mdhd')):raise AssertionError('Media duration/table mismatch')
        report.append({'kind':kind,'sample_descriptions':1,'samples':count,'chunks':len(offsets)})
    if any(a[1]>b[0] for a,b in zip(sorted(ranges),sorted(ranges)[1:])):raise AssertionError('Overlapping/duplicated sample references')
    return {'mdat_boxes':len(media),'tracks':report,'sample_ranges_disjoint':True}

def float_pcm(path):
    return subprocess.check_output(['ffmpeg','-v','error','-xerror','-i',str(path),'-map','0:a:0','-c:a','pcm_f32le','-f','f32le','-'])

def audit_variant(base,path,name,reference_playback,reference_pcm,points):
    a=probe(base);b=probe(path);extra=4 if name in ('T','K') else 0
    if len(b['streams'])!=2:raise AssertionError('Unexpected track count')
    timing={}
    for kind in ('video','audio'):
        s=stream(a,kind);t=stream(b,kind);p=packet_list(a,kind);q=packet_list(b,kind)
        for field in ['codec_name','codec_tag_string','profile','extradata_hash','width','height','pix_fmt','color_range','color_space','color_transfer','color_primaries','sample_rate','channels','side_data_list']:
            if s.get(field)!=t.get(field):raise AssertionError(kind+' configuration changed: '+field)
        if len(q)!=len(p)+(extra if kind=='audio' else 0):raise AssertionError('Unexpected sample count')
        if [x['data_hash'] for x in p]!=[x['data_hash'] for x in q[:len(p)]]:raise AssertionError('Original packet hash changed')
        deltas=[]
        for old,new in zip(p,q):
            delta=Fraction(new['pts'])*Fraction(t['time_base'])-Fraction(old['pts'])*Fraction(s['time_base']);deltas.append(delta)
            if kind=='audio':
                for field in ('dts','duration'):
                    error=Fraction(new[field])*Fraction(t['time_base'])-Fraction(old[field])*Fraction(s['time_base'])
                    if error!=(delta if field=='dts' else 0):raise AssertionError('Original AAC cadence/duration changed')
                if name in ('N','T') and any(old.get(f)!=new.get(f) for f in ('flags','side_data_list')):raise AssertionError('AAC priming/flags changed')
            if kind=='video':
                for field in ('pts','dts','duration'):
                    if Fraction(new[field])*Fraction(t['time_base'])!=Fraction(old[field])*Fraction(s['time_base']):raise AssertionError('Video timing changed')
                if old['flags']!=new['flags']:raise AssertionError('Video keyframe changed')
        if len(set(deltas))!=1:raise AssertionError('Nonuniform original audio shift')
        timing[kind]={'original_packets':len(p),'output_packets':len(q),'pts_shift_seconds_exact':str(deltas[0]),'original_packet_hashes_verified':True,
            'source_ordered_packet_hash_aggregate':checksum('\n'.join(x['data_hash'] for x in p).encode()),
            'output_original_prefix_hash_aggregate':checksum('\n'.join(x['data_hash'] for x in q[:len(p)]).encode()),
            'appended_packet_hashes':[x['data_hash'] for x in q[len(p):]]}
    if extra:
        q=packet_list(b,'audio');scale=Fraction(stream(b,'audio')['time_base'])
        if any(Fraction(p['duration'])*scale!=Fraction(1024,int(stream(b,'audio')['sample_rate'])) for p in q[-4:]):raise AssertionError('Tail sample duration not 1024/rate')
        if any(int(p['pts'])+int(p['duration'])!=int(q[i+1]['pts']) for i,p in enumerate(q[:-1])):raise AssertionError('AAC tail/prefix has gap or overlap')
    played=playback(path,b)
    if played['ordered_decoded_frame_hashes']!=reference_playback['ordered_decoded_frame_hashes'] or played['all_frame_hdr']!=reference_playback['all_frame_hdr']:raise AssertionError('Video/HDR decode changed')
    decoded=float_pcm(path);prefix=decoded[:len(reference_pcm)]==reference_pcm
    seeks=seek_checks(path,points);reference_seeks=seek_checks(base,points)
    if name=='N': verify(a,b,base,path,require_zero_origin=True)
    if name=='T' and (not prefix or len(decoded)<=len(reference_pcm)):raise AssertionError('Tail join changed original decoded PCM prefix')
    channels=int(stream(b,'audio')['channels']);extension=decoded[len(reference_pcm):] if prefix else b''
    floats=struct.unpack('<'+'f'*(len(extension)//4),extension) if extension else []
    return {'sha256':checksum(path.read_bytes()),'bytes':path.stat().st_size,'format_duration':b['format'].get('duration'),
        'structure':structure(path),'table_validation':inspect_tables(path),'interleaving':interleaving(b),'timing':timing,
        'original_video_pixels_and_hdr':'identical, full-clip decoded',
        'decoded_video_frames':played['decoded_video_frames'],'decoded_pcm_matches':decoded==reference_pcm,'original_pcm_prefix_matches':prefix,
        'decoded_pcm_sha256':checksum(decoded),'decoded_audio_samples_per_channel':len(decoded)//(4*channels),
        'source_audio_skip_samples':[p.get('side_data_list') for p in packet_list(a,'audio') if p.get('side_data_list')],
        'output_audio_skip_samples':[p.get('side_data_list') for p in packet_list(b,'audio') if p.get('side_data_list')],
        'added_pcm_samples_per_channel':(len(decoded)-len(reference_pcm))//(4*channels),'extension_peak':max((abs(x) for x in floats),default=None),
        'native_seeks':seeks,'video_seek_matches':all(s['decoded_video_frame_hash']==t['decoded_video_frame_hash'] for s,t in zip(seeks,reference_seeks)),
        'audio_seek_matches':all(s['decoded_audio_window_hash']==t['decoded_audio_window_hash'] for s,t in zip(seeks,reference_seeks)),
        'audio_mutated':name in ('O','T','K'),'audio_packets_appended':extra,'not_a_lossless_audio_export':name in ('O','T','K')}

def main(source,a_path,d_path,out,mutations=False):
    source,a_path,d_path,out=map(Path,(source,a_path,d_path,out));out.mkdir(parents=True,exist_ok=True)
    if any(out.iterdir()):raise ValueError('Prototype output directory must be empty')
    source_audit=probe(source);audit=probe(d_path);assert_source_boxes(source,d_path);verify(source_audit,audit,source,d_path,require_zero_origin=True)
    verify(source_audit,probe(a_path),source,a_path,Fraction(1,10000))
    asc=asc_data(d_path);audio=stream(audit,'audio');rate=int(audio['sample_rate']);channels=int(audio['channels']);canonical_aac(asc,rate,channels)
    base_playback=playback(d_path,audit);base_pcm=float_pcm(d_path)
    length=Fraction(stream(audit,'video')['duration_ts'])*Fraction(stream(audit,'video')['time_base']);points=[length*x for x in [Fraction(1,5),Fraction(1,2),Fraction(4,5)]]
    report={'scope':'Offline independently written structural prototype; no TikTok upload or quality evidence. N preserves audio; O/T/K mutate audio and are diagnostics only.',
        'reference_scope':'previously inspected HQ1 structure, not a byte-for-byte clone or authenticated end-to-end run',
        'ffmpeg_version':subprocess.check_output(['ffmpeg','-version']).decode().splitlines()[0],
        'baselines':{k:{'sha256':checksum(p.read_bytes()),'structure':structure(p),'bytes':p.stat().st_size,'source_timing_errors':timing_measurements(source_audit,probe(p))} for k,p in [('source',source),('A',a_path),('D',d_path)]},'variants':{},'blocked':{}}
    tail=[]
    if mutations:
        nodes=parse(d_path.read_bytes());audio_stbl=next(b for _,_,b,h in tracks(nodes) if h==b'soun')
        dt=list(x for r in groups(child(audio_stbl,b'stts')['payload'],8) for x in [u32(r,4)]*u32(r))
        try:tail=tail_packets(rate,channels,asc,dt)
        except ValueError as error: report['blocked']['T']=report['blocked']['K']=str(error)
    for name in (['N','O','T','K'] if mutations else ['N']):
        if name in report['blocked']:continue
        path=out/(name+{'N':'-layout.mp4','O':'-AUDIO-ORIGIN-CHANGED.mp4','T':'-FOUR-AAC-TAILS.mp4','K':'-ORIGIN-AND-TAILS.mp4'}[name])
        rebuild(d_path,path,name,asc,tail)
        report['variants'][name]=audit_variant(d_path,path,name,base_playback,base_pcm,points)
    (out/'prototype.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'variants':{n:{k:v[k] for k in ['bytes','timing','audio_mutated','decoded_pcm_matches','original_pcm_prefix_matches','video_seek_matches','audio_seek_matches']} for n,v in report['variants'].items()},'blocked':report['blocked']},indent=2))

if __name__=='__main__':
    try:
        if len(sys.argv) not in (5,6) or (len(sys.argv)==6 and sys.argv[5]!='--audio-mutations'): raise ValueError('Usage: SOURCE A_SMART D_SOURCE EMPTY_OUT [--audio-mutations]')
        main(*sys.argv[1:5],mutations=len(sys.argv)==6)
    except Exception as error:
        print('Prototype validation FAILED; partial files are not validated exports:',error,file=sys.stderr);sys.exit(1)
