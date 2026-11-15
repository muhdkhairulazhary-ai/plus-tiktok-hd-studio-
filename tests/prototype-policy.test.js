import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const available=spawnSync('python3',['--version']).status===0;
test('independent prototype rejects unsupported AAC configurations, tail joins and accidental audio-mutation defaults',{skip:!available},()=>{
 const run=spawnSync('python3',['-c',`import sys,importlib.util,inspect
sys.path.insert(0,'tools')
spec=importlib.util.spec_from_file_location('kf','tools/kf-prototype.py');k=importlib.util.module_from_spec(spec);spec.loader.exec_module(k)
assert k.desc(5,bytes(128))[:3]==bytes([5,129,0])
assert len(k.canonical_aac(bytes.fromhex('1190'),48000,2))>40
for asc,rate,ch in [(bytes.fromhex('1194'),48000,2),(bytes.fromhex('1190'),44100,2),(bytes.fromhex('1190'),48000,1),(bytes.fromhex('1180'),48000,0)]:
 try:k.canonical_aac(asc,rate,ch)
 except ValueError:pass
 else:raise AssertionError('Accepted incompatible AAC configuration')
try:k.tail_packets(48000,2,bytes.fromhex('1190'),[1024,896])
except ValueError as e:assert 'shortened' in str(e)
else:raise AssertionError('Accepted unsafe AAC join')
assert inspect.signature(k.main).parameters['mutations'].default is False
`],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});
