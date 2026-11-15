import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frontloadMp4} from '../src/fast-start.js';
import {listBoxes} from '../src/hdr.js';
const u32=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
function box(type,...parts) {return new Blob([u32(8+parts.reduce((n,p)=>n+p.size,0)),type,...parts]);}
const bytes=b=>new Blob([b]);
function movie(offset,wide=false) {
  const pointer=new Uint8Array(wide?8:4),view=new DataView(pointer.buffer);
  if(wide)view.setBigUint64(0,BigInt(offset));else view.setUint32(0,offset);
  const table=box(wide?'co64':'stco',bytes(new Uint8Array(4)),bytes(u32(1)),bytes(pointer));
  return box('moov',box('trak',box('mdia',box('minf',box('stbl',table)))));
}
async function pointer(file) {
  let parent=(await listBoxes(file,0,file.size)).find(b=>b.type==='moov');
  for(const type of ['trak','mdia','minf','stbl']) parent=(await listBoxes(file,parent.data,parent.end)).find(b=>b.type===type);
  const table=(await listBoxes(file,parent.data,parent.end)).find(b=>['stco','co64'].includes(b.type));
  const data=new DataView(await file.slice(table.data+8,table.end).arrayBuffer());
  return table.type==='co64'?Number(data.getBigUint64(0)):data.getUint32(0);
}
for(const wide of [false,true])test(`fast-start updates ${wide?'co64':'stco'} without changing bytes, samples, or adding padding`,async()=>{
  const ftyp=box('ftyp',bytes(new TextEncoder().encode('isom0000'))),mdat=box('mdat',bytes(new Uint8Array([21,34,55,89]))),free=box('free');
  const moov=movie(ftyp.size+free.size+8,wide);
  const source=new Blob([ftyp,free,mdat,moov]);
  source.arrayBuffer=()=>{throw Error('A full-file read is forbidden');};
  const result=await frontloadMp4(source,new AbortController().signal);
  const top=await listBoxes(result.blob,0,result.blob.size),media=top.find(b=>b.type==='mdat');
  assert.ok(result.fastStart);assert.equal(result.blob.size,source.size);
  assert.deepEqual(top.map(b=>b.type),['ftyp','moov','free','mdat']);
  assert.equal(await pointer(result.blob),media.data);
  assert.deepEqual(new Uint8Array(await result.blob.slice(media.data,media.end).arrayBuffer()),new Uint8Array([21,34,55,89]));
  const again=await frontloadMp4(result.blob);assert.equal(again.blob,result.blob);assert.ok(again.fastStart);
});
test('multiple media boxes are relocated with independent offset mapping',async()=>{
  const ftyp=box('ftyp'),a=box('mdat',bytes(new Uint8Array([1]))),b=box('mdat',bytes(new Uint8Array([2])));
  const source=new Blob([ftyp,a,b,movie(ftyp.size+a.size+8)]);
  const result=await frontloadMp4(source);const mdats=(await listBoxes(result.blob,0,result.blob.size)).filter(b=>b.type==='mdat');
  assert.equal(await pointer(result.blob),mdats[1].data);assert.equal(result.blob.size,source.size);
});
test('unknown offset-bearing layouts preserve the original file with an explicit notice',async()=>{
  const ftyp=box('ftyp'),mdat=box('mdat',bytes(new Uint8Array([1])));
  const source=new Blob([ftyp,box('sidx'),mdat,movie(ftyp.size+8+8)]);
  const result=await frontloadMp4(source);assert.equal(result.blob,source);assert.equal(result.fastStart,false);assert.match(result.note,/Original MP4 retained/);
});
test('malformed offset tables and chunks outside media are rejected',async()=>{
  await assert.rejects(frontloadMp4(new Blob([box('ftyp'),box('mdat',bytes(new Uint8Array([1]))),movie(0)])),/outside media/);
  await assert.rejects(frontloadMp4(new Blob(['bad'])),/boundary/);
});
test('cancellation is honored before fast-start work',async()=>{
  const abort=new AbortController();abort.abort();await assert.rejects(frontloadMp4(new Blob(),abort.signal),{name:'AbortError'});
});
