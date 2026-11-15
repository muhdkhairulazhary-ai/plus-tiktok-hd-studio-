// Inspect ISO BMFF structures using range reads. Never search arbitrary mdat bytes for box names.
const ascii = b => String.fromCharCode(...b);
const hex = b => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
async function read(file, offset, size) {
  const bytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
  if (bytes.length !== size) throw Error('Truncated MOV/MP4 metadata.');
  return bytes;
}
async function boxes(file, start, end, signal) {
  const result = [];
  while (start < end) {
    signal?.throwIfAborted();
    if (end - start < 8) throw Error('Invalid MP4 box boundary.');
    const head = await read(file, start, 8), view = new DataView(head.buffer);
    let size = view.getUint32(0), header = 8;
    if (size === 1) { const ext = await read(file, start + 8, 8); size = Number(new DataView(ext.buffer).getBigUint64(0)); header = 16; }
    if (size === 0) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || start + size > end) throw Error('Invalid MP4 box size.');
    result.push({ type: ascii(head.subarray(4,8)), start, data: start + header, end: start + size });
    if (result.length > 100000) throw Error('Excessive MP4 metadata complexity.');
    start += size;
  }
  return result;
}
export async function inspectContainer(file, signal) {
  const top = await boxes(file,0,file.size,signal), moov = top.find(b=>b.type==='moov');
  if (!moov) throw Error('A MOV/MP4 movie header is required.');
  const children = b => boxes(file,b.data,b.end,signal);
  const movie = await children(moov), entries = [];
  for (const trak of movie.filter(b=>b.type==='trak')) {
    const mdia = (await children(trak)).find(b=>b.type==='mdia'); if (!mdia) continue;
    const media = await children(mdia), hdlr = media.find(b=>b.type==='hdlr');
    if (!hdlr || ascii(await read(file,hdlr.data+8,4))!=='vide') continue;
    const minf=media.find(b=>b.type==='minf'); if(!minf) continue;
    const stbl=(await children(minf)).find(b=>b.type==='stbl'); if(!stbl) continue;
    const stsd=(await children(stbl)).find(b=>b.type==='stsd'); if(!stsd) continue;
    for (const entry of await boxes(file,stsd.data+8,stsd.end,signal)) {
      const sub=await boxes(file,entry.data+78,entry.end,signal), records={};
      for(const b of sub) {
        if(b.end-b.data>1048576) throw Error('Sample metadata is too large to validate safely.');
        (records[b.type]??=[]).push(await read(file,b.data,b.end-b.data));
      }
      entries.push({type:entry.type,records});
    }
  }
  return { entries, fragmented:top.some(b=>b.type==='moof') || movie.some(b=>b.type==='mvex') };
}
function seiMessages(nal, state) {
  // HEVC prefix/suffix SEI RBSP: remove emulation prevention bytes, then read payloads.
  const rbsp=[];
  for(let i=2;i<nal.length;i++) { if(i>=4 && nal[i]===3 && nal[i-1]===0 && nal[i-2]===0) continue; rbsp.push(nal[i]); }
  for(let pos=0;pos<rbsp.length;) {
    if(rbsp[pos]===128 && pos===rbsp.length-1) break;
    let type=0,size=0;
    while(rbsp[pos]===255){type+=255;pos++;} if(pos>=rbsp.length) break; type+=rbsp[pos++];
    while(rbsp[pos]===255){size+=255;pos++;} if(pos>=rbsp.length) break; size+=rbsp[pos++];
    if(pos+size>rbsp.length) throw Error('Malformed HEVC SEI.');
    if(type===137 && size!==24 || type===144 && size!==4) throw Error('Malformed HDR static SEI metadata.');
    if(type===137 || type===144) state.staticMetadata.add(`${type}:${hex(rbsp.slice(pos,pos+size))}`);
    if(type===4) state.unregisteredHDR=true; // Registered user data may include dynamic HDR10+/other metadata.
    pos+=size;
  }
}
export function inspectNal(nal,state) {
  if(nal.length<2) throw Error('Invalid HEVC NAL unit.');
  const type=(nal[0]>>1)&63;
  if(type===62 || type===63) state.dolbyVision=true; // RPU / enhancement-related reserved NALs: fail closed.
  if(type===39 || type===40) seiMessages(nal,state);
}
export function inspectPacketNals(data, lengthSize, state) {
  for(let offset=0;offset<data.length;) {
    if(offset+lengthSize>data.length) throw Error('Truncated length-prefixed HEVC packet.');
    let size=0; for(let i=0;i<lengthSize;i++) size=size*256+data[offset+i]; offset+=lengthSize;
    if(size<2 || offset+size>data.length) throw Error('Invalid HEVC packet length.');
    inspectNal(data.subarray(offset,offset+size),state); offset+=size;
  }
}
export function hdrFromEntry(entry, colorSpace = {}) {
  const records=entry?.records??{}, hvcc=records.hvcC?.[0];
  const state={staticMetadata:new Set(),dolbyVision:['dvhe','dvh1'].includes(entry?.type)||['dvcC','dvvC','dvwC'].some(k=>records[k]),unregisteredHDR:false};
  if(hvcc && hvcc.length>=23) {
    let pos=23;
    for(let a=0;a<hvcc[22];a++) {
      if(pos+3>hvcc.length) throw Error('Truncated hvcC arrays.');
      pos++;const count=hvcc[pos++]*256+hvcc[pos++];
      for(let n=0;n<count;n++) { if(pos+2>hvcc.length) throw Error('Truncated hvcC NAL.');const size=hvcc[pos++]*256+hvcc[pos++];if(pos+size>hvcc.length)throw Error('Truncated hvcC NAL.');inspectNal(hvcc.subarray(pos,pos+size),state);pos+=size; }
    }
  }
  const colr=records.colr?.[0]; let color=null;
  if(colr && ['nclx','nclc'].includes(ascii(colr.subarray(0,4))) && colr.length>=10) {
    const v=new DataView(colr.buffer,colr.byteOffset,colr.byteLength);
    color={primaries:v.getUint16(4),transfer:v.getUint16(6),matrix:v.getUint16(8),fullRange:colr.length>=11?!!(colr[10]&128):null};
  }
  const rawColor=color;
  const primariesMap={bt709:1,bt2020:9},transferMap={bt709:1,'iec61966-2-1':13,pq:16,hlg:18},matrixMap={bt709:1,'bt2020-ncl':9};
  color={primaries:color?.primaries!==2?color?.primaries:null,transfer:color?.transfer!==2?color?.transfer:null,matrix:color?.matrix!==2?color?.matrix:null,fullRange:color?.fullRange??null};
  color.primaries??=primariesMap[colorSpace.primaries]??null; color.transfer??=transferMap[colorSpace.transfer]??null; color.matrix??=matrixMap[colorSpace.matrix]??null; color.fullRange??=colorSpace.fullRange??null;
  const unsupported=Object.keys(records).filter(k=>!['hvcC','avcC','colr','pasp','btrt'].includes(k));
  if(records.fiel?.length===1 && records.fiel[0].length===2 && records.fiel[0][0]===1 && records.fiel[0][1]===0) unsupported.splice(unsupported.indexOf('fiel'),1); // Progressive field order is also encoded in the retained SPS.
  for(const [name,values] of Object.entries(records)) if(values.length>1) unsupported.push(`duplicate ${name}`);
  return {state,color,rawColor,colorSpace,bitDepth:hvcc?.length>=23?8+(hvcc[17]&7):null,profile:hvcc?.length>=23?hvcc[1]&31:null,lengthSize:hvcc?.length>=23?(hvcc[21]&3)+1:null,hvcc,entryType:entry?.type,unsupported,
    staticBoxes:['mdcv','clli'].filter(k=>records[k]),records};
}
export function hdrLabel(hdr) {
  if(hdr.state.dolbyVision) return 'Dolby Vision (detected; preservation unsupported)';
  const transfer=hdr.color?.transfer, primaries=hdr.color?.primaries;
  if(primaries===9 && transfer===18 && hdr.bitDepth>=10) return 'HLG HDR';
  if(primaries===9 && transfer===16 && hdr.bitDepth>=10) return [...hdr.state.staticMetadata].some(v=>v.startsWith('137:'))?'HDR10':'Unknown (PQ HDR; static metadata unavailable)';
  if(transfer===1 && [1,9].includes(primaries)) return 'SDR';
  return 'Unknown';
}
export function assertCopyHDR(hdr, required=false) {
  if(hdr.state.dolbyVision) throw Error('Dolby Vision configuration/RPU retention is not supported and cannot be validated. Export stopped.');
  if(required && !['HLG HDR','HDR10'].includes(hdrLabel(hdr))) throw Error('HDR Preservation Required: complete supported HDR metadata was not detected.');
  if(!hdr.hvcc || hdr.hvcc[0]!==1 || hdr.entryType!=='hvc1') throw Error('Smart Copy currently requires a single hvc1 HEVC sample description. hev1/Dolby Vision entries are not validated.');
  if(hdr.unsupported.length) throw Error(`Smart Copy cannot retain these sample metadata boxes: ${hdr.unsupported.join(', ')}. No HDR preservation is claimed.`);
  if(hdr.records.colr && !hdr.rawColor) throw Error('ICC/unknown color metadata cannot be retained by this remuxer.');
  if(hdr.state.unregisteredHDR) throw Error('Dynamic HDR registered-user-data SEI is not validated by this pipeline.');
  const isHDR=[16,18].includes(hdr.color?.transfer)||['pq','hlg'].includes(hdr.colorSpace.transfer);
  if(isHDR || required) {
    if(!hdr.color || hdr.color.primaries!==9 || ![16,18].includes(hdr.color.transfer) || hdr.color.matrix!==9 || hdr.color.fullRange===null || hdr.bitDepth<10) throw Error('HDR preservation requires complete BT.2020 PQ/HLG color metadata (container or retained SPS VUI) and a 10-bit HEVC configuration. Metadata is incomplete.');
  }
}
export function hdrSummary(hdr) {
  return {label:hdrLabel(hdr),primaries:hdr.color?.primaries??'Unknown',transfer:hdr.color?.transfer??'Unknown',matrix:hdr.color?.matrix??'Unknown',bitDepth:hdr.bitDepth??'Unknown',profile:hdr.profile??'Unknown',staticMetadata:[...hdr.state.staticMetadata],staticBoxes:hdr.staticBoxes,dolbyVisionConfiguration:['dvcC','dvvC','dvwC'].filter(k=>hdr.records[k]).map(k=>`${k} (${hdr.records[k][0].length} bytes)`),dolbyVision:hdr.state.dolbyVision,unsupported:hdr.unsupported,hasUnsupportedColor:!!hdr.records.colr&&!hdr.rawColor,hasHDRSignal:[16,18].includes(hdr.color?.transfer)||['pq','hlg'].includes(hdr.colorSpace.transfer)||hdr.bitDepth>8||hdr.state.staticMetadata.size>0||hdr.staticBoxes.length>0||hdr.state.unregisteredHDR||hdr.state.dolbyVision};
}
