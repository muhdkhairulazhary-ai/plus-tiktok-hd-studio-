import { resolveSettings } from './settings.js';
export function processingPlan(source, settings={}) {
  const mode=settings.mode??(source.videoCodec==='hevc'?'smart':'convert'),hdr=settings.hdr??'auto';
  if(!['smart','compat','convert','custom'].includes(mode) || !['auto','required','sdr'].includes(hdr)) throw Error('Invalid processing/HDR mode.');
  if(hdr==='sdr') throw Error('SDR conversion is disabled: a validated color-managed HDR tone mapper is not available.');
  if(mode==='smart'||mode==='compat') {
    if(source.videoCodec!=='hevc' || source.copyReason) throw Error(source.copyReason||'Smart Copy requires compatible HEVC. Choose HEVC Conversion for lossy encoding.');
    if(source.audio?.codec!=='mp4a.40.2') throw Error('Smart Copy requires AAC-LC. Audio-only transcoding is unavailable in Smart Copy; HEVC Conversion supports audio transcoding for SDR sources.');
    if((settings.resolution??'original')!=='original'||(settings.fps??'original')!=='original'||(settings.quality??'preserve')!=='preserve') throw Error('Smart Copy cannot apply resolution, FPS or bitrate changes. Choose Custom Encoding.');
    if(hdr==='required' && !['HLG HDR','HDR10'].includes(source.hdr?.label)) throw Error('HDR Preservation Required: source HDR metadata is incomplete or unsupported.');
    return {mode,config:{width:source.width,height:source.height,frameRate:undefined,bitrate:source.videoBitrate,estimatedSize:source.videoBytes+source.audioBytes+4096+(source.videoPackets+source.audioPackets)*20,targetSize:null,sizeNote:'Original encoded video and AAC packets will be verified. Container overhead may change; equal file size is not required for identical encoded quality.'}};
  }
  if(hdr==='required') throw Error('HDR re-encoding is unavailable: a complete validated 10-bit color-managed encoding/metadata pipeline is not available in Safari. Use eligible Smart Copy.');
  if(source.hdr?.hasUnsupportedColor || source.hdr?.hasHDRSignal || source.hdr?.dolbyVision || source.hdr?.bitDepth!=='Unknown' && source.hdr?.bitDepth>8 || (!source.hdr || source.hdr.bitDepth==='Unknown')) throw Error('HDR/10-bit/unknown-depth video cannot be faithfully re-encoded by this pipeline. Use eligible Smart Copy; automatic HDR-to-SDR conversion is disabled.');
  return {mode,config:resolveSettings(source.width,source.height,settings,source)};
}
