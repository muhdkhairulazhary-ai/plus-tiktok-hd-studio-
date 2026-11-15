import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compatibilityMp4} from '../src/compatibility.js';
import {listBoxes} from '../src/hdr.js';
const u32=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
const box=(type,...parts)=>new Blob([u32(8+parts.reduce((n,b)=>n+b.size,0)),type,...parts]);
const raw=b=>new Blob([b]);
function movie(offset,wide=false) {
  const data=new Uint8Array(wide?8:4),v=new DataView(data.buffer);
  if(wide)v.setBigUint64(0,BigInt(offset));else v.setUint32(0,offset);
  return box('moov',box('trak',box('mdia',box('minf',box('stbl',box(wide?'co64':'stco',raw(new Uint8Array(4)),raw(u32(1)),raw(data)))))));
}
async function table(blob) {
  let p=(await listBoxes(blob,0,blob.size)).find(b=>b.type==='moov');
  for(const type of ['trak','mdia','minf','stbl'])p=(await listBoxes(blob,p.data,p.end)).find(b=>b.type===type);
  return (await listBoxes(blob,p.data,p.end)).find(b=>['co64','stco'].includes(b.type));
}
for(const wide of [false,true])test(`experimental ${wide?'co64':'stco'} reconstruction preserves media and reports exact metadata growth`,async()=>{
  const ftyp=box('ftyp'),mdat=box('mdat',raw(new Uint8Array([8,13,21]))),source=new Blob([ftyp,mdat,movie(ftyp.size+8,wide)]);
  source.arrayBuffer=()=>{throw Error('Full-media reads are forbidden');};
  const result=await compatibilityMp4(source,new AbortController().signal),top=await listBoxes(result.blob,0,result.blob.size),m=top.find(b=>b.type==='mdat'),t=await table(result.blob);
  assert.equal(t.type,'co64');assert.ok(top.find(b=>b.type==='moov').start<m.start);
  assert.equal(Number(new DataView(await result.blob.slice(t.data+8,t.end).arrayBuffer()).getBigUint64(0)),m.data);
  assert.deepEqual(new Uint8Array(await result.blob.slice(m.data,m.end).arrayBuffer()),new Uint8Array([8,13,21]));
  assert.equal(result.tableBytesAdded,wide?0:4);assert.equal(result.blob.size,source.size+result.tableBytesAdded);
  assert.match(result.note,/benefit is unproven/);
  const second=await compatibilityMp4(result.blob);assert.equal(second.tableBytesAdded,0);assert.equal(second.blob.size,result.blob.size);
});
test('experimental mode fails on malformed/unsupported offsets and honors cancellation',async()=>{
  const ftyp=box('ftyp'),mdat=box('mdat',raw(new Uint8Array([1])));
  await assert.rejects(compatibilityMp4(new Blob([ftyp,mdat,movie(0)])),/outside media/);
  await assert.rejects(compatibilityMp4(new Blob([ftyp,box('sidx'),mdat,movie(ftyp.size+16)])),/ordinary/);
  const controller=new AbortController();controller.abort();await assert.rejects(compatibilityMp4(new Blob(),controller.signal),{name:'AbortError'});
});
