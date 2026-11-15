// Offline only. No application imports this entry point or its Python inspector.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { smartCopy } from '../src/smart-copy.js';
const args=process.argv.slice(2);
if(args.length!==2){console.error('Usage: node tools/mp4-ab.mjs INPUT.mov EMPTY_OUTPUT_DIRECTORY');process.exit(2);}
const input=resolve(args[0]),out=resolve(args[1]);
await mkdir(out,{recursive:true});
if((await readdir(out)).length)throw Error('Output directory must be empty (existing evidence is never overwritten).');
const result=await smartCopy(new Blob([await readFile(input)]),()=>{},new AbortController().signal,{mode:'smart'});
await writeFile(join(out,'A-smart.mp4'),new Uint8Array(await result.blob.arrayBuffer()));
const run=spawnSync('python3',[join(dirname(fileURLToPath(import.meta.url)),'mp4_ab.py'),input,out],{stdio:'inherit'});
if(run.error)throw run.error;
process.exitCode=run.status??1;
