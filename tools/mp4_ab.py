"""Offline, deliberately narrow ISO BMFF A/B builder and independent FFprobe audit.
Only accepts the ordinary nonfragmented, single-description HEVC/AAC MP4 made by A.
No third-party patcher code. No encoder, network, extra samples or extra tracks.
"""
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

def structure(path):
    nodes=parse(path.read_bytes()); movie=one(nodes,b'moov'); result={'top':[n['type'].decode() for n in nodes],'movie_timescale':timescale(child(movie,b'mvhd')),'movie_duration_ticks':duration(child(movie,b'mvhd')),'tracks':[]}
    for track,mdia,stbl,handler in tracks(nodes):
        t={'handler':handler.decode(),'track_duration_ticks':duration(child(track,b'tkhd')),'media_timescale':timescale(child(mdia,b'mdhd')),'media_duration_ticks':duration(child(mdia,b'mdhd')),'edits':edits(track),'sample_entry_sha256':hashlib.sha256(child(stbl,b'stsd')['raw']).hexdigest(),'tables':{}}
        for n in stbl['children']:
            if n['type'] in {b'stts',b'ctts',b'cslg',b'stsc',b'stco',b'co64',b'stss',b'sbgp',b'sgpd',b'stsz'}:
                t['tables'][n['type'].decode()]={'bytes':len(n['raw']),'sha256':hashlib.sha256(n['raw']).hexdigest(),'hex':n['payload'].hex() if len(n['raw'])<256 else None}
        result['tracks'].append(t)
    return result

def verify(reference, candidate, path_a, path_b, tolerance=Fraction(0)):
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

def main(source, out):
    paths={'source':Path(source),'A':Path(out)/'A-smart.mp4','B':Path(out)/'B-audio-tables.mp4','C':Path(out)/'C-interleave-clock.mp4'}
    a=probe(paths['A']); reconstruct(paths['A'],paths['B'],'B',a); reconstruct(paths['A'],paths['C'],'C',a)
    report={'scope':'Offline only; no TikTok uploads, no production changes. No evidence of rendition benefit.','ffmpeg_version':subprocess.check_output(['ffmpeg','-version']).decode().splitlines()[0],'variants':{}}
    for name,path in paths.items():
        p=probe(path)
        report['variants'][name]={'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'structure':structure(path),'interleaving':interleaving(p),'streams':p['streams'],'packets':p['packets'],'first_frame_hdr_metadata':frames(path),'decoded_pcm':pcm(path)}
        if name in ('B','C'):
            report['variants'][name]['validation']=verify(a,p,paths['A'],path)
            for t,u in zip(structure(paths['A'])['tracks'],report['variants'][name]['structure']['tracks']):
                if t['sample_entry_sha256']!=u['sample_entry_sha256']: raise AssertionError('Raw sample entry changed')
                if t['media_timescale']!=u['media_timescale'] or t['media_duration_ticks']!=u['media_duration_ticks']: raise AssertionError('Track clock/duration changed')
                for table_name in ['ctts','cslg','stss','sgpd','sbgp']:
                    if t['tables'].get(table_name)!=u['tables'].get(table_name): raise AssertionError('Timing/group table changed')
        elif name=='A': report['variants'][name]['validation']=verify(probe(paths['source']),p,paths['source'],path,Fraction(1,10000))
    Path(out,'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    lines=['# Offline MP4 A/B results','',report['scope'],'','B/C packet, configuration, timing, decoded PCM and first-frame HDR checks against A passed. A was checked against source with 100 µs timing tolerance.','', '| Variant | Bytes | Movie clock | Video chunks | Audio chunks | Physical track runs |','| --- | ---: | ---: | ---: | ---: | ---: |']
    for name,v in report['variants'].items():
        ts=v['structure']['tracks']; chunks=lambda kind: next(t for t in ts if t['handler']==kind)['tables']['stco']['bytes']//4-4
        lines.append(f"| {name} | {v['bytes']} | {v['structure']['movie_timescale']} | {chunks('vide')} | {chunks('soun')} | {v['interleaving']['track_runs']} |")
    lines+=['','Full table hashes/short table bytes, edit lists, stream/rotation/color/configuration metadata, sample hashes and exact per-packet timing are in comparison.json. Unknown HDR fields remain unknown; matching absent metadata is not proof of HDR support.','', 'B rebuilds audio stts/stsz/stsc/stco with one AAC sample per chunk, preserving original edit/priming and media bytes. C uses one-sample chunks in DTS order and an exactly representable common movie clock, retaining track clocks and edit media_time. Neither adds AAC tails or changes media duration.']
    Path(out,'comparison.md').write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines))

if __name__=='__main__':
    try: main(*sys.argv[1:])
    except Exception as e:
        print('A/B validation FAILED; do not use these outputs:',str(e),file=sys.stderr); sys.exit(1)
