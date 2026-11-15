"""Offline, deliberately narrow ISO BMFF A/B builder and independent FFprobe audit.
Only accepts the ordinary nonfragmented, single-description HEVC/AAC MP4 made by A.
No third-party patcher code. No encoder, network, extra samples or extra tracks.
"""
import copy
import hashlib
import itertools
import json
import math
import struct
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

CONTAINERS = {b'moov', b'trak', b'mdia', b'minf', b'stbl', b'edts'}
def u32(data, at=0): return struct.unpack_from('>I', data, at)[0]
def u64(data, at=0): return struct.unpack_from('>Q', data, at)[0]
def pack(*values): return struct.pack('>' + 'I' * len(values), *values)
def box(kind, data):
    if len(data)+8 > 0xffffffff: raise ValueError('Offline metadata exceeds 32-bit box budget')
    return pack(len(data)+8)+kind+data

def parse(data):
    nodes=[]; pos=0
    while pos < len(data):
        if pos+8 > len(data): raise ValueError('Truncated box header')
        size=u32(data,pos); kind=data[pos+4:pos+8]; header=8
        if size==1:
            if pos+16 > len(data): raise ValueError('Truncated extended header')
            size=u64(data,pos+8); header=16
        if size==0: size=len(data)-pos
        if size<header or pos+size>len(data): raise ValueError('Invalid box bounds')
        payload=data[pos+header:pos+size]
        nodes.append({'type':kind,'start':pos,'header':header,'payload':payload,'raw':data[pos:pos+size],
                      'children':parse(payload) if kind in CONTAINERS else None})
        pos+=size
    return nodes

def one(nodes, kind):
    found=[n for n in nodes if n['type']==kind]
    if len(found)!=1: raise ValueError('Expected exactly one '+kind.decode())
    return found[0]
def child(node, kind): return one(node['children'],kind)
def serialize(n):
    if n['children'] is None: return n['raw']
    return box(n['type'],b''.join(serialize(c) for c in n['children']))
def replace(n, payload): n.update(payload=payload,raw=box(n['type'],payload))
def table(n, kind, payload):
    old=child(n,kind); replace(old,payload)
def timescale(n):
    data=n['payload']; return u32(data,20 if data[0]==1 else 12)
def duration(n):
    data=n['payload']; v=data[0]; kind=n['type']
    at=(28 if v else 20) if kind==b'tkhd' else (24 if v else 16)
    return u64(data,at) if v else u32(data,at)
def retime(n, factor, movie=False):
    data=bytearray(n['payload']); v=data[0]
    if v not in (0,1): raise ValueError('Unknown time header version')
    at=(28 if v else 20) if n['type']==b'tkhd' else (24 if v else 16)
    value=duration(n)*factor
    if value >= (1 << (64 if v else 32)): raise ValueError('Normalized duration overflow; refusing rounding')
    struct.pack_into('>Q' if v else '>I',data,at,value)
    if movie: struct.pack_into('>I',data,20 if v else 12,timescale(n)*factor)
    replace(n,bytes(data))
def edits(track):
    edts=next((n for n in track['children'] if n['type']==b'edts'),None)
    if edts is None: return []
    data=child(edts,b'elst')['payload']; v=data[0]; width=20 if v else 12
    if v not in (0,1) or len(data)!=8+u32(data,4)*width: raise ValueError('Invalid edit table')
    return [{'duration':u64(data,8+i*width) if v else u32(data,8+i*width),
             'media_time':struct.unpack_from('>q' if v else '>i',data,8+i*width+(8 if v else 4))[0],
             'rate':list(struct.unpack_from('>hh',data,8+i*width+(16 if v else 8)))} for i in range(u32(data,4))]
def normalize_edits(track, factor):
    edts=next((n for n in track['children'] if n['type']==b'edts'),None)
    if edts is None: return
    n=child(edts,b'elst'); data=bytearray(n['payload']); v=data[0]; width=20 if v else 12
    for i,e in enumerate(edits(track)):
        value=e['duration']*factor
        if value >= (1 << (64 if v else 32)): raise ValueError('Edit duration overflow')
        struct.pack_into('>Q' if v else '>I',data,8+i*width,value)
    replace(n,bytes(data))

def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',str(path)]))
def pcm(path):
    return subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-f','hash','-hash','sha256','-']).decode().strip()
def frames(path):
    value=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-read_intervals','%+1','-show_frames','-of','json',str(path)]))
    # Only metadata with defined semantics; decoder user-data/build strings aren't HDR validation.
    return [[s for s in f.get('side_data_list',[]) if 'Mastering' in s['side_data_type'] or 'Content light' in s['side_data_type']] for f in value['frames'][:1]]
def groups(data, width):
    if data[:4]!=bytes(4) or len(data)!=8+u32(data,4)*width: raise ValueError('Invalid table length/version')
    return [data[8+i*width:8+(i+1)*width] for i in range(u32(data,4))]
def tracks(nodes):
    movie=one(nodes,b'moov'); result=[]
    for n in movie['children']:
        if n['type']!=b'trak': continue
        mdia=child(n,b'mdia'); stbl=child(child(mdia,b'minf'),b'stbl')
        handler=child(mdia,b'hdlr')['payload'][8:12]
        result.append((n,mdia,stbl,handler))
    if sorted(t[3] for t in result)!=[b'soun',b'vide']: raise ValueError('Expected one video and one audio track')
    return result

def reconstruct(a_path, dest, mode, audit):
    # Offline desktop harness intentionally uses memory. Never imported into the Safari app.
    original=a_path.read_bytes(); nodes=parse(original); movie=one(nodes,b'moov'); ts=tracks(nodes)
    if any(n['type'] not in {b'ftyp',b'moov',b'mdat',b'free'} for n in nodes): raise ValueError('Unsupported top-level layout')
    media=one(nodes,b'mdat'); one(nodes,b'ftyp')
    packets={kind:[p for p in audit['packets'] if p['codec_type']==kind] for kind in ['video','audio']}
    offsets={}
    for track,mdia,stbl,handler in ts:
        kind='video' if handler==b'vide' else 'audio'; ps=packets[kind]
        if any(n['type'] not in {b'stsd',b'stts',b'ctts',b'cslg',b'stss',b'stsc',b'stsz',b'stco',b'co64',b'sgpd',b'sbgp'} for n in stbl['children']): raise ValueError('Unsupported sample table')
        if u32(child(stbl,b'stsd')['payload'],4)!=1: raise ValueError('Multiple sample descriptions unsupported')
        if len([n for n in stbl['children'] if n['type'] in (b'stco',b'co64')])!=1: raise ValueError('Ambiguous offsets')
        if any('pos' not in p or 'size' not in p for p in ps): raise ValueError('Packets must reference file bytes')
        if mode=='B' and kind=='video': continue
        # Single sample per chunk: no alternative sample descriptions and no added samples.
        stsz=child(stbl,b'stsz')['payload']; count=u32(stsz,8)
        sizes=[u32(stsz,4)]*count if u32(stsz,4) else [u32(stsz,12+i*4) for i in range(count)]
        if sizes!=[int(p['size']) for p in ps]: raise ValueError('FFprobe/sample-table disagreement')
        stts=groups(child(stbl,b'stts')['payload'],8)
        durations=list(itertools.chain.from_iterable(itertools.repeat(u32(r,4),u32(r)) for r in stts))
        if len(durations)!=count or any(d<=0 for d in durations): raise ValueError('Invalid decode durations')
        runs=[(len(list(g)),d) for d,g in itertools.groupby(durations)]
        table(stbl,b'stts',bytes(4)+pack(len(runs))+b''.join(pack(c,d) for c,d in runs))
        table(stbl,b'stsz',bytes(4)+pack(0,count)+b''.join(pack(s) for s in sizes))
        table(stbl,b'stsc',bytes(4)+pack(1,1,1,1))
        off=next(n for n in stbl['children'] if n['type'] in (b'stco',b'co64'))
        if off['type']!=b'stco': raise ValueError('Expected baseline stco; co64 is not this experiment')
        offsets[kind]=off
        replace(off,bytes(4)+pack(count)+bytes(count*4))
    if mode=='C':
        # Exact integer movie-timescale normalization. Track clocks and media_time stay intact.
        mvhd=child(movie,b'mvhd'); old=timescale(mvhd)
        new=math.lcm(old,*(timescale(child(m,b'mdhd')) for _,m,_,_ in ts))
        if new>0xffffffff: raise ValueError('Exact common movie clock too large')
        factor=new//old; retime(mvhd,factor,True)
        for t,_,_,_ in ts: retime(child(t,b'tkhd'),factor); normalize_edits(t,factor)
    # For B all mdat bytes and their relative positions stay exactly intact.
    # For C tightly repack one-sample chunks by decode time, a valid alternate interleave.
    ftyp=one(nodes,b'ftyp')['raw']; rebuilt=serialize(movie); start=len(ftyp)+len(rebuilt)+8
    if mode=='B':
        old_start=media['start']+media['header']
        shift=start-old_start
        for _,_,stbl,handler in ts:
            kind='video' if handler==b'vide' else 'audio'
            off=next(n for n in stbl['children'] if n['type']==b'stco')
            positions=([int(p['pos']) for p in packets[kind]] if kind=='audio' else [u32(r) for r in groups(off['payload'],4)])
            values=[p+shift for p in positions]
            if any(v<start or v>=start+len(media['payload']) or v>0xffffffff for v in values): raise ValueError('Unsafe chunk pointer')
            replace(off,bytes(4)+pack(len(values))+b''.join(pack(v) for v in values))
        payload=media['payload']
    else:
        events=[]
        for index,s in enumerate(audit['streams']):
            kind=s['codec_type']
            for i,p in enumerate(packets[kind]):
                events.append((Fraction(p['dts'])*Fraction(s['time_base']),index,i,kind,p))
        events.sort(key=lambda e:e[:3]); parts=[]; cursor=start; positions={'video':{},'audio':{}}
        for _,_,i,kind,p in events:
            pos=int(p['pos']); size=int(p['size'])
            if pos<media['start']+media['header'] or pos+size>media['start']+len(media['raw']): raise ValueError('Sample outside mdat')
            part=original[pos:pos+size]
            if len(part)!=size or hashlib.sha256(part).hexdigest().lower()!=p['data_hash'].split(':')[1].lower(): raise ValueError('Sample bounds/hash mismatch')
            positions[kind][i]=cursor; parts.append(part); cursor+=size
        if cursor>0xffffffff: raise ValueError('Offline variants limited to 32-bit chunk offsets')
        payload=b''.join(parts)
        for kind,off in offsets.items(): replace(off,bytes(4)+pack(len(packets[kind]))+b''.join(pack(positions[kind][i]) for i in range(len(packets[kind]))))
    rebuilt=serialize(movie)
    if len(rebuilt)+len(ftyp)+8!=start: raise ValueError('Metadata size changed after offset assignment')
    dest.write_bytes(ftyp+rebuilt+box(b'mdat',payload))


def source_timing(source_path, a_path, dest):
    """D: transplant original clock/edit/sample-description semantics onto A's media layout.
    All represented samples must match in one-to-one decode order. No inferred timestamps.
    """
    original=a_path.read_bytes(); nodes=parse(original); source=parse(source_path.read_bytes())
    source_audit=probe(source_path); a_audit=probe(a_path)
    target_tracks=tracks(nodes); source_tracks={h:(t,m,b) for t,m,b,h in tracks(source)}
    media=one(nodes,b'mdat'); ftyp=one(nodes,b'ftyp')['raw']; movie=one(nodes,b'moov')
    if any(n['type'] not in {b'ftyp',b'moov',b'mdat',b'free'} for n in nodes): raise ValueError('D requires ordinary A layout')
    def transplant(parent, originals, kinds):
        replacements=[copy.deepcopy(n) for n in originals if n['type'] in kinds]
        index=next((i for i,n in enumerate(parent['children']) if n['type'] in kinds),0)
        kept=[n for n in parent['children'] if n['type'] not in kinds]
        parent['children']=kept[:index]+replacements+kept[index:]
    transplant(movie,one(source,b'moov')['children'],{b'mvhd'})
    temporal={b'stsd',b'stts',b'ctts',b'cslg',b'stss',b'sgpd',b'sbgp',b'sdtp'}
    allowed=temporal|{b'stsc',b'stsz',b'stco',b'co64'}
    def sample_sizes(stbl):
        data=child(stbl,b'stsz')['payload']
        if len(data)<12 or data[:4]!=bytes(4): raise ValueError('Invalid sample sizes')
        count=u32(data,8); constant=u32(data,4)
        if len(data)!=(12 if constant else 12+count*4): raise ValueError('Invalid size table count')
        return [constant]*count if constant else [u32(data,12+i*4) for i in range(count)]
    for track,mdia,stbl,handler in target_tracks:
        src_track,src_mdia,src_stbl=source_tracks[handler]
        if len({n['type'] for n in src_stbl['children']})!=len(src_stbl['children']): raise ValueError('D duplicate source sample tables unsupported')
        if any(n['type'] not in allowed for n in src_stbl['children']): raise ValueError('D cannot retain unknown source sample table')
        if u32(child(src_stbl,b'stsd')['payload'],4)!=1: raise ValueError('D requires one source sample description')
        sizes=sample_sizes(src_stbl)
        kind='video' if handler==b'vide' else 'audio'
        if any(len([p for p in audit['packets'] if p['codec_type']==kind])!=len(sizes) for audit in [source_audit,a_audit]): raise ValueError('D requires all raw source samples to be represented once')
        if sizes!=sample_sizes(stbl): raise ValueError('D requires identical one-to-one source/A samples')
        count=sum(u32(r) for r in groups(child(src_stbl,b'stts')['payload'],8))
        if count!=len(sizes): raise ValueError('D source timing/sample counts disagree')
        # Simple continuous media edit, optionally preceded by an empty presentation delay.
        # Loops, rates and multiple trimmed segments need a sample-to-edit mapping not implemented here.
        edit_list=edits(src_track)
        if (len(edit_list)>2 or any(e['rate']!=[1,0] for e in edit_list)
            or sum(e['media_time']>=0 for e in edit_list)>1
            or any(e['media_time']<0 and (i!=0 or e['media_time']!=-1) for i,e in enumerate(edit_list))):
            raise ValueError('D does not support complex/rate-changing source edits')
        transplant(track,src_track['children'],{b'tkhd',b'edts'})
        transplant(mdia,src_mdia['children'],{b'mdhd'})
        transplant(stbl,src_stbl['children'],temporal)
    rebuilt=serialize(movie); old_start=media['start']+media['header']; start=len(ftyp)+len(rebuilt)+8
    for _,_,stbl,_ in target_tracks:
        off=child(stbl,b'stco'); values=[u32(r)+start-old_start for r in groups(off['payload'],4)]
        if any(p<start or p>=start+len(media['payload']) or p>0xffffffff for p in values): raise ValueError('D unsafe chunk pointer')
        replace(off,bytes(4)+pack(len(values))+b''.join(pack(v) for v in values))
    final=serialize(movie)
    if len(final)!=len(rebuilt): raise ValueError('D metadata size changed after offset assignment')
    dest.write_bytes(ftyp+final+box(b'mdat',media['payload']))
    assert_source_boxes(source_path,dest)

def assert_source_boxes(source_path, dest):
    source=parse(source_path.read_bytes()); target=parse(dest.read_bytes())
    if child(one(source,b'moov'),b'mvhd')['raw']!=child(one(target,b'moov'),b'mvhd')['raw']: raise AssertionError('D movie clock changed')
    for s,t in zip(sorted(tracks(source),key=lambda x:x[3]),sorted(tracks(target),key=lambda x:x[3])):
        for originals,candidates,kinds in [(s[0]['children'],t[0]['children'],{b'tkhd',b'edts'}),
                (s[1]['children'],t[1]['children'],{b'mdhd'}),
                (s[2]['children'],t[2]['children'],{b'stsd',b'stts',b'ctts',b'cslg',b'stss',b'sgpd',b'sbgp',b'sdtp'})]:
            select=lambda ns:{n['type']:serialize(n) for n in ns if n['type'] in kinds}
            if select(originals)!=select(candidates): raise AssertionError('D source timing/config/edit boxes changed')

def structure(path):
    nodes=parse(path.read_bytes()); movie=one(nodes,b'moov'); result={'top':[n['type'].decode() for n in nodes],'movie_timescale':timescale(child(movie,b'mvhd')),'movie_duration_ticks':duration(child(movie,b'mvhd')),'mvhd_sha256':hashlib.sha256(child(movie,b'mvhd')['raw']).hexdigest(),'tracks':[]}
    for track,mdia,stbl,handler in tracks(nodes):
        t={'handler':handler.decode(),'header_edit_sha256':{n['type'].decode():hashlib.sha256(serialize(n)).hexdigest() for n in track['children'] if n['type'] in {b'tkhd',b'edts'}},'mdhd_sha256':hashlib.sha256(child(mdia,b'mdhd')['raw']).hexdigest(),'track_duration_ticks':duration(child(track,b'tkhd')),'media_timescale':timescale(child(mdia,b'mdhd')),'media_duration_ticks':duration(child(mdia,b'mdhd')),'edits':edits(track),'sample_entry_sha256':hashlib.sha256(child(stbl,b'stsd')['raw']).hexdigest(),'tables':{}}
        for n in stbl['children']:
            if n['type'] in {b'stts',b'ctts',b'cslg',b'stsc',b'stco',b'co64',b'stss',b'sbgp',b'sgpd',b'stsz',b'sdtp'}:
                t['tables'][n['type'].decode()]={'bytes':len(n['raw']),'sha256':hashlib.sha256(n['raw']).hexdigest(),'hex':n['payload'].hex() if len(n['raw'])<256 else None}
        result['tracks'].append(t)
    return result

def verify(reference, candidate, path_a, path_b, tolerance=Fraction(0), require_zero_origin=False):
    if len(candidate['streams'])!=2: raise AssertionError('Additional/missing tracks')
    common_offset=None
    for kind in ['video','audio']:
        s=next(s for s in reference['streams'] if s['codec_type']==kind); t=next(s for s in candidate['streams'] if s['codec_type']==kind)
        for field in ['codec_name','codec_tag_string','profile','extradata_hash','width','height','pix_fmt','color_range','color_space','color_transfer','color_primaries','sample_rate','channels','side_data_list']:
            if s.get(field)!=t.get(field): raise AssertionError(f'{kind} {field} changed')
        a=[p for p in reference['packets'] if p['codec_type']==kind]; b=[p for p in candidate['packets'] if p['codec_type']==kind]
        if len(a)!=len(b) or not a: raise AssertionError('Sample count changed')
        for p,q in zip(a,b):
            for field in ['data_hash','size','flags','side_data_list']:
                if p.get(field)!=q.get(field): raise AssertionError(f'{kind} packet {field} changed')
            offset=Fraction(q['pts'])*Fraction(t['time_base'])-Fraction(p['pts'])*Fraction(s['time_base'])
            if common_offset is None: common_offset=offset
            if abs(offset-common_offset)>tolerance: raise AssertionError('PTS/A/V offset changed')
            for field in ['dts','duration']:
                delta=Fraction(q[field])*Fraction(t['time_base'])-Fraction(p[field])*Fraction(s['time_base'])
                expected=common_offset if field=='dts' else 0
                if abs(delta-expected)>tolerance: raise AssertionError(f'{kind} {field} changed')
    if require_zero_origin and common_offset!=0: raise AssertionError('D shifted source presentation origin')
    if pcm(path_a)!=pcm(path_b): raise AssertionError('Decoded PCM/priming changed')
    if frames(path_a)!=frames(path_b): raise AssertionError('HDR frame metadata changed')
    return {'packet_hashes':'identical for video and AAC','pts_dts_duration':'verified per packet','common_offset_seconds':float(common_offset),'decoded_pcm':'identical','first_frame_hdr_metadata':'identical (presence reported separately)'}

def interleaving(audit):
    ordered=sorted(audit['packets'],key=lambda p:int(p['pos']))
    runs=[(kind,list(g)) for kind,g in itertools.groupby(ordered,key=lambda p:p['codec_type'])]
    return {'track_runs':len(runs),'largest_consecutive_run_samples':max(len(g) for _,g in runs),
            'first_20_track_runs':[[kind,len(g)] for kind,g in runs[:20]],
            'timeline':{kind:{'packets':len(ps),'first_pts_seconds':min(float(p['pts_time']) for p in ps),
                'last_end_seconds':max(float(p['pts_time'])+float(p['duration_time']) for p in ps)}
                for kind in ['video','audio'] for ps in [[p for p in ordered if p['codec_type']==kind]]}}


def timing_measurements(reference,candidate):
    result={}
    for kind in ['video','audio']:
        s=next(s for s in reference['streams'] if s['codec_type']==kind); t=next(s for s in candidate['streams'] if s['codec_type']==kind)
        a=[p for p in reference['packets'] if p['codec_type']==kind]; b=[p for p in candidate['packets'] if p['codec_type']==kind]
        if len(a)!=len(b): raise AssertionError('Cannot compare unequal packet timelines')
        result[kind]={'source_timebase':s['time_base'],'output_timebase':t['time_base']}
        for field in ['pts','dts','duration']:
            delta=max(abs(Fraction(q[field])*Fraction(t['time_base'])-Fraction(p[field])*Fraction(s['time_base'])) for p,q in zip(a,b))
            result[kind]['max_'+field+'_error_seconds_exact']=str(delta)
            result[kind]['max_'+field+'_error_microseconds']=float(delta*1000000)
        result[kind]['stream_duration_seconds_exact']=str(Fraction(t['duration_ts'])*Fraction(t['time_base']))
        result[kind]['stream_duration_error_seconds_exact']=str(Fraction(t['duration_ts'])*Fraction(t['time_base'])-Fraction(s['duration_ts'])*Fraction(s['time_base']))
    return result

def playback(path,audit):
    # Decode every video frame, compare pixel hashes in presentation order independently of output encoder clock.
    raw=subprocess.check_output(['ffmpeg','-v','error','-xerror','-noautorotate','-i',str(path),'-map','0:v:0','-an','-fps_mode','passthrough','-f','framemd5','-']).decode()
    checksums=[line.split(',')[-1].strip() for line in raw.splitlines() if line and not line.startswith('#')]
    value=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-of','json',str(path)]))
    decoded=value['frames']; hdr=[]
    for f in decoded:
        hdr.append({k:f.get(k) for k in ['color_range','color_space','color_transfer','color_primaries']}|
            {'side_data':[s for s in f.get('side_data_list',[]) if 'Mastering' in s['side_data_type'] or 'Content light' in s['side_data_type']]})
    # Native accurate seeks at three interior points. Hash a decoded video frame plus a short audio window.
    duration=Fraction(next(s['duration_ts'] for s in audit['streams'] if s['codec_type']=='video'))*Fraction(next(s['time_base'] for s in audit['streams'] if s['codec_type']=='video'))
    return {'decoded_video_frames':len(checksums),'ordered_decoded_frame_hashes':checksums,'all_frame_hdr':hdr,
            'video_duration_seconds_exact':str(duration),
            'decoded_frame_hash_aggregate':hashlib.sha256('\n'.join(checksums).encode()).hexdigest(),
            'all_frame_hdr_aggregate':hashlib.sha256(json.dumps(hdr,sort_keys=True).encode()).hexdigest()}

def seek_checks(path, points):
    result=[]
    for point in points:
        base=['ffmpeg','-v','error','-xerror','-ss',str(float(point)),'-noautorotate','-i',str(path)]
        video=subprocess.check_output(base+['-map','0:v:0','-frames:v','1','-f','hash','-hash','sha256','-']).decode().strip()
        audio=subprocess.check_output(base+['-map','0:a:0','-t','0.1','-f','hash','-hash','sha256','-']).decode().strip()
        result.append({'target_seconds_exact':str(point),'decoded_video_frame_hash':video,'decoded_audio_window_hash':audio})
    return result

def main(source, out):
    paths={'source':Path(source),'A':Path(out)/'A-smart.mp4','B':Path(out)/'B-audio-tables.mp4','C':Path(out)/'C-interleave-clock.mp4','D':Path(out)/'D-source-timing.mp4'}
    source_audit=probe(paths['source']); a=probe(paths['A']); reconstruct(paths['A'],paths['B'],'B',a); reconstruct(paths['A'],paths['C'],'C',a)
    source_timing(paths['source'],paths['A'],paths['D'])
    source_playback=playback(paths['source'],source_audit)
    source_duration=Fraction(source_playback['video_duration_seconds_exact'])
    points=[source_duration*x for x in [Fraction(1,5),Fraction(1,2),Fraction(4,5)]]
    source_seeks=seek_checks(paths['source'],points)
    report={'scope':'Offline only; no TikTok uploads, no production changes. No evidence of rendition benefit.','ffmpeg_version':subprocess.check_output(['ffmpeg','-version']).decode().splitlines()[0],'variants':{}}
    for name,path in paths.items():
        p=probe(path)
        report['variants'][name]={'bytes':path.stat().st_size,'format_duration':p['format'].get('duration'),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'structure':structure(path),'interleaving':interleaving(p),'streams':p['streams'],'packets':p['packets'],'first_frame_hdr_metadata':frames(path),'decoded_pcm':pcm(path),'source_timing_errors':timing_measurements(source_audit,p),
            'native_playback':source_playback if name=='source' else playback(path,p),
            'native_seeks':source_seeks if name=='source' else seek_checks(path,points)}
        if name in ('B','C'):
            report['variants'][name]['validation']=verify(a,p,paths['A'],path)
            for t,u in zip(structure(paths['A'])['tracks'],report['variants'][name]['structure']['tracks']):
                if t['sample_entry_sha256']!=u['sample_entry_sha256']: raise AssertionError('Raw sample entry changed')
                if t['media_timescale']!=u['media_timescale'] or t['media_duration_ticks']!=u['media_duration_ticks']: raise AssertionError('Track clock/duration changed')
                for table_name in ['ctts','cslg','stss','sgpd','sbgp']:
                    if t['tables'].get(table_name)!=u['tables'].get(table_name): raise AssertionError('Timing/group table changed')
        elif name=='D':
            report['variants'][name]['validation']=verify(source_audit,p,paths['source'],path,require_zero_origin=True)
            assert_source_boxes(paths['source'],path)
            if report['variants'][name]['native_seeks']!=source_seeks: raise AssertionError('D source seeking mismatch')
        elif name=='A': report['variants'][name]['validation']=verify(probe(paths['source']),p,paths['source'],path,Fraction(1,10000))
        played=report['variants'][name]['native_playback']
        if played['ordered_decoded_frame_hashes']!=source_playback['ordered_decoded_frame_hashes']: raise AssertionError('Full decoded video pixels changed')
        if played['all_frame_hdr']!=source_playback['all_frame_hdr']: raise AssertionError('Full-clip decoded HDR metadata changed')
        report['variants'][name]['native_seek_matches_source']=report['variants'][name]['native_seeks']==source_seeks
    Path(out,'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    lines=['# Offline MP4 A/B results','',report['scope'],'','B/C packet, configuration, timing and decoded PCM checks against A passed. D preserves exact source timestamps and timing/edit boxes, decoded video/audio and native seek results. All variants passed full-clip video pixel/HDR checks. A was checked against source with 100 µs timing tolerance.','', '| Variant | Bytes | Movie clock | Video chunks | Audio chunks | Physical track runs |','| --- | ---: | ---: | ---: | ---: | ---: |']
    for name,v in report['variants'].items():
        ts=v['structure']['tracks']; chunks=lambda kind: next(t for t in ts if t['handler']==kind)['tables']['stco']['bytes']//4-4
        lines.append(f"| {name} | {v['bytes']} | {v['structure']['movie_timescale']} | {chunks('vide')} | {chunks('soun')} | {v['interleaving']['track_runs']} |")
    lines+=['','Full table hashes/short table bytes, edit lists, stream/rotation/color/configuration metadata, sample hashes and exact per-packet timing are in comparison.json. Unknown HDR fields remain unknown; matching absent metadata is not proof of HDR support.','', 'B rebuilds audio stts/stsz/stsc/stco with one AAC sample per chunk, preserving original edit/priming and media bytes. C uses one-sample chunks in DTS order and an exactly representable common movie clock, retaining track clocks and edit media_time. D transplants exact source timing, edits and codec/sample-group descriptions onto A media/chunk layout. No variant adds AAC tails.']
    Path(out,'comparison.md').write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines))

if __name__=='__main__':
    try: main(*sys.argv[1:])
    except Exception as e:
        print('A/B validation FAILED; do not use these outputs:',str(e),file=sys.stderr); sys.exit(1)
