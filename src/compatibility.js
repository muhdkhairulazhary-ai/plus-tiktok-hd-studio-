import { listBoxes } from './hdr.js';

/** Optional standards-only experiment: canonical 64-bit chunk offsets and front moov.
 * Rebuild only the affected table/container headers. All other metadata and media stay intact.
 * This is not an implementation of HIDZZ's audio or request modifications.
 */
export async function compatibilityMp4(file, signal) {
  signal?.throwIfAborted();
  const top=await listBoxes(file,0,file.size,signal),movies=top.filter(b=>b.type==='moov'),types=top.filter(b=>b.type==='ftyp'),media=top.filter(b=>b.type==='mdat');
  if(movies.length!==1 || types.length!==1 || !media.length || top.some(b=>!['ftyp','moov','mdat','free','skip','wide'].includes(b.type))) throw Error('Experimental compatibility requires an ordinary self-contained MP4 layout. Use Smart Copy.');
  const moov=movies[0],ftyp=types[0];
  if(moov.end-moov.start>64*1048576) throw Error('Experimental metadata exceeds its memory budget. Use Smart Copy.');
  const source=new Uint8Array(await file.slice(moov.start,moov.end).arrayBuffer()),view=new DataView(source.buffer);
  const containers=new Set(['moov','trak','mdia','minf','stbl']);let visited=0,tables=0,growth=0;
  function parse(start,end,depth=0) {
    if(depth>8)throw Error('Excessive MP4 metadata nesting.');
    const nodes=[];
    for(let p=start;p<end;) {
      signal?.throwIfAborted();
      if(++visited>100000 || p+8>end)throw Error('Invalid experimental MP4 metadata.');
      let size=view.getUint32(p),header=8;const type=String.fromCharCode(...source.subarray(p+4,p+8));
      if(size===1){if(p+16>end)throw Error('Truncated extended MP4 box.');size=Number(view.getBigUint64(p+8));header=16;}
      if(size===0)size=end-p;
      if(!Number.isSafeInteger(size)||size<header||p+size>end)throw Error('Invalid experimental MP4 box size.');
      const node={type,start:p,data:p+header,end:p+size,header,size,outputSize:size};
      if(['mvex','saio','sidx','iloc'].includes(type))throw Error('Experimental mode cannot safely relocate auxiliary/fragment offsets. Use Smart Copy.');
      if(containers.has(type)) {
        node.children=parse(node.data,node.end,depth+1);
        if(type==='stbl' && node.children.filter(n=>n.type==='stco'||n.type==='co64').length!==1) throw Error('Expected one chunk offset table per track.');
        node.outputSize=header+node.children.reduce((sum,n)=>sum+n.outputSize,0);
      }
      if(type==='stco'||type==='co64') {
        node.width=type==='stco'?4:8;
        if(node.data+8>node.end || view.getUint32(node.data)!==0)throw Error('Invalid chunk offset full box.');
        node.count=view.getUint32(node.data+4);
        if(node.data+8+node.count*node.width!==node.end)throw Error('Invalid chunk offset entry count.');
        node.outputSize=header+8+node.count*8;growth+=node.count*(8-node.width);tables++;
      }
      if(node.outputSize>0xffffffff)throw Error('Experimental metadata is too large to rebuild safely.');
      nodes.push(node);p+=size;
    }
    return nodes;
  }
  const roots=parse(0,source.length),root=roots[0];
  if(roots.length!==1||root.type!=='moov'||!tables)throw Error('No complete movie/chunk tables found.');
  if(root.outputSize>64*1048576)throw Error('Experimental expanded metadata exceeds its memory budget. Use Smart Copy.');
  const order=[ftyp,moov,...top.filter(b=>b!==ftyp&&b!==moov)],positions=new Map();let position=0;
  for(const b of order){positions.set(b,position);position+=b===moov?root.outputSize:b.end-b.start;}
  if(!Number.isSafeInteger(position))throw Error('Experimental output offsets exceed numeric precision.');
  const rewritten=new Uint8Array(root.outputSize),out=new DataView(rewritten.buffer);
  async function write(node,at) {
    signal?.throwIfAborted();
    if(!node.children && !node.width) {rewritten.set(source.subarray(node.start,node.end),at);return;}
    const type=node.width?'co64':node.type;
    out.setUint32(at,node.header===16?1:node.outputSize);
    for(let i=0;i<4;i++)rewritten[at+4+i]=type.charCodeAt(i);
    if(node.header===16)out.setBigUint64(at+8,BigInt(node.outputSize));
    const data=at+node.header;
    if(node.children) {let cursor=data;for(const child of node.children){await write(child,cursor);cursor+=child.outputSize;}return;}
    out.setUint32(data,0);out.setUint32(data+4,node.count);
    for(let i=0;i<node.count;i++) {
      if(i%4096===0){signal?.throwIfAborted();if(i)await new Promise(resolve=>setTimeout(resolve,0));}
      const p=node.data+8+i*node.width,offset=node.width===8?Number(view.getBigUint64(p)):view.getUint32(p);
      const mdat=media.find(b=>offset>=b.data&&offset<b.end);
      if(!Number.isSafeInteger(offset)||!mdat)throw Error('Experimental chunk points outside media payload.');
      out.setBigUint64(data+8+i*8,BigInt(offset-mdat.start+positions.get(mdat)));
    }
  }
  await write(root,0);signal?.throwIfAborted();
  const blob=new Blob(order.map(b=>b===moov?rewritten:file.slice(b.start,b.end)),{type:'video/mp4'});
  if(blob.size!==file.size+growth)throw Error('Unexpected experimental MP4 size change.');
  return {blob,fastStart:true,tableBytesAdded:growth,note:`Experimental: front MP4 index with co64 chunk offsets. ${growth} metadata bytes added; no media samples, timing changes or extra tracks. TikTok quality benefit is unproven.`};
}
