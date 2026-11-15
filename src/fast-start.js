import { listBoxes } from './hdr.js';

class UnsupportedLayout extends Error {}
/** Relocate an ordinary MP4 moov without re-encoding or allocating another media-sized buffer.
 * Only stco/co64 offsets change. Media is reused as Blob slices; no samples or padding are added.
 */
export async function frontloadMp4(file, signal) {
  signal?.throwIfAborted();
  const top = await listBoxes(file, 0, file.size, signal);
  const movie = top.filter(b => b.type === 'moov'), types = top.filter(b => b.type === 'ftyp');
  const media = top.filter(b => b.type === 'mdat');
  const fallback = reason => ({ blob: file, fastStart: false, note: `Original MP4 retained: ${reason}` });
  if (movie.length !== 1 || types.length !== 1 || !media.length) throw Error('Invalid ordinary MP4 structure.');
  const moov = movie[0], ftyp = types[0];
  if (moov.start < media[0].start) return { blob: file, fastStart: true, note: 'MP4 index already precedes media.' };
  if (top.some(b => !['ftyp','moov','mdat','free','skip','wide'].includes(b.type))) return fallback('layout requires offset handling beyond stco/co64.');
  // This is a metadata allocation safeguard, not an input-file-size restriction.
  if (moov.end - moov.start > 64 * 1048576) return fallback('movie metadata exceeds the fast-start memory budget.');
  const order = [ftyp, moov, ...top.filter(b => b !== ftyp && b !== moov)];
  const positions = new Map(); let position = 0;
  for (const box of order) { positions.set(box,position); position += box.end - box.start; }
  const bytes = new Uint8Array(await file.slice(moov.start,moov.end).arrayBuffer());
  const view = new DataView(bytes.buffer); let tables = 0, visited = 0;
  const containerTypes = new Set(['moov','trak','mdia','minf','stbl']);
  async function walk(start,end,depth=0) {
    if (depth > 8) throw Error('Excessive MP4 metadata nesting.');
    for (let p=start;p<end;) {
      signal?.throwIfAborted();
      if (++visited > 100000 || p+8>end) throw Error('Invalid MP4 metadata boundary.');
      let size=view.getUint32(p), header=8;
      const type=String.fromCharCode(...bytes.subarray(p+4,p+8));
      if (size===1) { if(p+16>end)throw Error('Truncated extended MP4 box.');size=Number(view.getBigUint64(p+8));header=16; }
      if (size===0) size=end-p;
      if(!Number.isSafeInteger(size)||size<header||p+size>end)throw Error('Invalid MP4 metadata size.');
      const data=p+header;
      if(['mvex','saio','iloc','sidx'].includes(type)) throw new UnsupportedLayout('fragmented/auxiliary offset metadata is not supported.');
      if(containerTypes.has(type)) await walk(data,p+size,depth+1);
      if(type==='stco'||type==='co64') {
        const width=type==='co64'?8:4;
        if(data+8>p+size || view.getUint32(data)!==0) throw Error('Invalid chunk offset table.');
        const count=view.getUint32(data+4);
        if(data+8+count*width!==p+size) throw Error('Truncated chunk offset table.');
        for(let i=0;i<count;i++) {
          if(i%4096===0) { signal?.throwIfAborted(); if(i)await new Promise(resolve=>setTimeout(resolve,0)); }
          const at=data+8+i*width,old=width===8?Number(view.getBigUint64(at)):view.getUint32(at);
          const mdat=media.find(b=>old>=b.data&&old<b.end);
          if(!Number.isSafeInteger(old)||!mdat) throw Error('MP4 chunk points outside media payload.');
          const next=old-mdat.start+positions.get(mdat);
          if(!Number.isSafeInteger(next)||next<0)throw Error('Invalid relocated chunk offset.');
          if(width===4 && next>0xffffffff) throw new UnsupportedLayout('32-bit chunk offsets would overflow; no unsafe offset conversion attempted.');
          if(width===8)view.setBigUint64(at,BigInt(next));else view.setUint32(at,next);
        }
        tables++;
      }
      p+=size;
    }
  }
  try { await walk(0,bytes.length); }
  catch(error) { if(error instanceof UnsupportedLayout)return fallback(error.message);throw error; }
  if(!tables)throw Error('No MP4 chunk offset tables found.');
  signal?.throwIfAborted();
  const blob=new Blob(order.map(b=>b===moov?bytes:file.slice(b.start,b.end)),{type:'video/mp4'});
  if(blob.size!==file.size)throw Error('Fast-start unexpectedly changed MP4 byte length.');
  return {blob,fastStart:true,note:'MP4 index precedes media; encoded samples and file size are unchanged.'};
}
