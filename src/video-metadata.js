import { EncodedPacketSink } from 'mediabunny';
import { inspectContainer, hdrFromEntry, inspectPacketNals, hdrSummary, assertCopyHDR } from './hdr.js';
export async function videoMetadata(file, video, signal) {
  const container=await inspectContainer(file,signal), codec=await video.getCodec();
  const hdr=hdrFromEntry(container.entries[0],await video.getColorSpace());
  if(container.entries.length!==1) hdr.unsupported.push('multiple sample descriptions/video entries');
  if(container.fragmented) hdr.unsupported.push('fragmented input');
  if(codec==='hevc' && hdr.lengthSize) {
    for await(const packet of new EncodedPacketSink(video).packets()) { signal?.throwIfAborted();inspectPacketNals(packet.data,hdr.lengthSize,hdr.state); }
  }
  if(codec==='avc') {
    const config=await video.getDecoderConfig(), data=config?.description;
    const bytes=data?new Uint8Array(data.buffer??data,data.byteOffset??0,data.byteLength):null;
    if(bytes && [66,77,88,100].includes(bytes[1])) hdr.bitDepth=8;
  }
  let copyReason='';
  try { if(codec!=='hevc') throw Error('Source is not HEVC. HEVC conversion requires lossy video re-encoding.');assertCopyHDR(hdr); } catch(error) { copyReason=error.message; }
  return {hdr,summary:hdrSummary(hdr),codec,codecString:await video.getCodecParameterString(),copyReason};
}
