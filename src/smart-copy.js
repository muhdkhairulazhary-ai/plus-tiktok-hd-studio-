import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource } from 'mediabunny';
import { videoMetadata } from './video-metadata.js';
import { assertCopyHDR, hdrLabel } from './hdr.js';
import { frontloadMp4 } from './fast-start.js';
const sameBytes=(a,b)=>a?.length===b?.length && a?.every((v,i)=>v===b[i]);
const configBytes=config=>config?.description?new Uint8Array(config.description.buffer??config.description,config.description.byteOffset??0,config.description.byteLength):null;
const digest=async data=>new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',data));
export async function verifyTrack(source, destination, signal, offset=null, onPacket=()=>{}) {
  const a=new EncodedPacketSink(source).packets(), b=new EncodedPacketSink(destination).packets();
  let count=0;
  try {
    while(true) {
      signal?.throwIfAborted();
      const x=await a.next(),y=await b.next();
      if(x.done || y.done) {if(x.done!==y.done || !count)throw Error('Copied packet count mismatch or empty track.');break;}
      const p=x.value,q=y.value;
      if(!sameBytes(await digest(p.data),await digest(q.data))) throw Error('Encoded packet SHA-256 mismatch. No Re-encode verification failed.');
      offset??=q.timestamp-p.timestamp;
      if(Math.abs(q.timestamp-p.timestamp-offset)>.0001 || Math.abs(q.duration-p.duration)>.002 || p.type!==q.type) throw Error(`Copied packet timing, duration or keyframe/GOP structure changed: ${count} pts=${p.timestamp}/${q.timestamp} duration=${p.duration}/${q.duration} type=${p.type}/${q.type}.`);
      count++;onPacket(count);
    }
  } finally {await a.return();await b.return();}
  return {count,offset};
}
export async function smartCopy(file, progress, signal, settings={}) {
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  let output,check,done=false,finalized=false;
  const abort=()=>{if(!finalized) void output?.cancel().catch(()=>{});};signal.addEventListener('abort',abort);
  try {
    signal.throwIfAborted();
    if(!globalThis.crypto?.subtle) throw Error('Smart Copy requires secure HTTPS Web Crypto for SHA-256 verification. Open the HTTPS production site.');
    const videos=await input.getVideoTracks(),audios=await input.getAudioTracks();
    if(videos.length!==1 || audios.length!==1) throw Error('Smart Copy requires one video track and one audio track. Audio is never discarded.');
    const video=videos[0],audio=audios[0],meta=await videoMetadata(file,video,signal);
    if(meta.codec!=='hevc') throw Error('This input requires HEVC Conversion (lossy re-encoding).');
    assertCopyHDR(meta.hdr,settings.hdr==='required');
    if(await audio.getCodecParameterString()!=='mp4a.40.2') throw Error('Smart Copy currently requires AAC-LC audio. Audio-only transcoding is not implemented in Smart Copy; use HEVC Conversion for supported SDR input.');
    if(settings.resolution && settings.resolution!=='original' || settings.fps && settings.fps!=='original' || settings.quality && settings.quality!=='preserve') throw Error('Smart Copy cannot apply resolution, FPS or bitrate changes. Select Custom Encoding explicitly.');
    if(settings.hdr==='sdr') throw Error('Color-managed SDR tone mapping is not available.');
    const vConfig=await video.getDecoderConfig(),aConfig=await audio.getDecoderConfig();
    const vSource=new EncodedVideoPacketSource('hevc'),aSource=new EncodedAudioPacketSource('aac'),target=new BufferTarget();
    output=new Output({target,format:new Mp4OutputFormat({fastStart:false})});
    const trackMetadata=async track=>{const language=await track.getLanguageCode();return {name:(await track.getName())??undefined,languageCode:/^[a-z]{3}$/.test(language??'')?language:undefined,disposition:await track.getDisposition()};};
    output.addVideoTrack(vSource,{...await trackMetadata(video),transformationMatrix:await video.getTransformationMatrix()});
    output.addAudioTrack(aSource,await trackMetadata(audio));
    await output.start();
    const duration=await input.computeDuration();
    const vi=new EncodedPacketSink(video).packets(),ai=new EncodedPacketSink(audio).packets();
    let v=await vi.next(),a=await ai.next(),vFirst=true,aFirst=true,packets=0,lastProgress=0,videoCount=0,audioCount=0;
    try {
      // Interleave to keep the muxer's pending-track queues bounded; preserve each track's decode order.
      while(!v.done || !a.done) {
        signal.throwIfAborted();
        const useVideo=a.done || !v.done && v.value.timestamp<=a.value.timestamp;
        const p=useVideo?v.value:a.value;
        if(useVideo){await vSource.add(p,vFirst?{decoderConfig:vConfig}:undefined);vFirst=false;videoCount++;v=await vi.next();}
        else {await aSource.add(p,aFirst?{decoderConfig:aConfig}:undefined);aFirst=false;audioCount++;a=await ai.next();}
        lastProgress=Math.max(lastProgress,Math.min(75,Math.floor(Math.max(0,p.timestamp)/duration*75)));
        progress(lastProgress,'Copying original encoded packets…');
        if(++packets%64===0) await new Promise(resolve=>setTimeout(resolve,0));
      }
    } finally {await vi.return();await ai.return();}
    vSource.close();aSource.close();await output.finalize();finalized=true;signal.throwIfAborted();
    const muxed=new Blob([target.buffer],{type:'video/mp4'});target.buffer=null;
    progress(76,'Finalizing standard MP4 index for progressive access…');
    const finalizedMp4=await frontloadMp4(muxed,signal),blob=finalizedMp4.blob;
    check=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
    const ov=await check.getPrimaryVideoTrack(),oa=await check.getPrimaryAudioTrack();
    if(!ov || !oa || await ov.getCodec()!=='hevc' || await oa.getCodecParameterString()!==await audio.getCodecParameterString()) throw Error('Smart Copy MP4 codec verification failed.');
    const width=await video.getDisplayWidth(),height=await video.getDisplayHeight();
    if(await ov.getCodedWidth()!==await video.getCodedWidth() || await ov.getCodedHeight()!==await video.getCodedHeight() || await ov.getDisplayWidth()!==width || await ov.getDisplayHeight()!==height || JSON.stringify(await ov.getTransformationMatrix())!==JSON.stringify(await video.getTransformationMatrix())) throw Error('Smart Copy changed display dimensions or orientation.');
    const outMeta=await videoMetadata(blob,ov,signal);
    if(outMeta.codecString!==meta.codecString || !sameBytes(meta.hdr.hvcc,outMeta.hdr.hvcc) || !sameBytes(configBytes(aConfig),configBytes(await oa.getDecoderConfig()))) throw Error('Codec profile/configuration changed during remux.');
    if(await oa.getNumberOfChannels()!==await audio.getNumberOfChannels() || await oa.getSampleRate()!==await audio.getSampleRate()) throw Error('AAC channel count or sample rate changed.');
    if([16,18].includes(meta.hdr.color?.transfer) && (!outMeta.hdr.rawColor || ['primaries','transfer','matrix','fullRange'].some(k=>outMeta.hdr.rawColor[k]!==meta.hdr.color[k]))) throw Error('Output HDR nclx color metadata could not be verified.');
    if(meta.hdr.color && (!outMeta.hdr.color || ['primaries','transfer','matrix',...(meta.hdr.color.fullRange===null?[]:['fullRange'])].some(k=>meta.hdr.color[k]!==outMeta.hdr.color[k]))) throw Error('Source color metadata was not retained exactly.');
    if(JSON.stringify([...meta.hdr.state.staticMetadata].sort())!==JSON.stringify([...outMeta.hdr.state.staticMetadata].sort())) throw Error('HDR static SEI metadata changed.');
    progress(78,'Verifying original video packet SHA-256 hashes and timing…');
    const verifiedVideo=await verifyTrack(video,ov,signal,null,count=>{if(count%32===0 || count===videoCount)progress(78+Math.floor(count/videoCount*10),'Verifying video packet hashes and timing…');});
    progress(88,'Verifying original AAC packet SHA-256 hashes and sync…');
    await verifyTrack(audio,oa,signal,verifiedVideo.offset,count=>{if(count%32===0 || count===audioCount)progress(88+Math.floor(count/audioCount*8),'Verifying AAC packet hashes and A/V sync…');});
    const label=hdrLabel(meta.hdr),hdrPreserved=['HLG HDR','HDR10'].includes(label);
    const stats=await ov.computePacketStats();done=true;
    return {blob,width,height,fps:stats.averagePacketRate,codec:outMeta.codecString,audioCodec:await oa.getCodecParameterString(),audioCopied:true,videoCopied:true,processingMode:'Smart Copy',hdrStatus:hdrPreserved?`${label} preserved — verified configuration, color and packets`:label==='SDR'?'SDR — copied and verified':'HDR not verified (unknown source color metadata)',estimatedSize:null,targetSize:null,containerNote:finalizedMp4.note,fastStart:finalizedMp4.fastStart};
  } finally {
    signal.removeEventListener('abort',abort);
    if(!done && output && !finalized) await output.cancel().catch(()=>{});
    check?.dispose();input.dispose();
  }
}
