import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const local=existsSync('.env')?readFileSync('.env','utf8'):'';
const credentials=local.split('\n').filter(l=>/^NAVER_.*(?:CLIENT_ID|CLIENT_SECRET)=/.test(l)).map(l=>l.slice(l.indexOf('=')+1).trim()).filter(Boolean);
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean);
const matches=[];for(const file of files){const data=readFileSync(file);if(credentials.some(value=>data.includes(Buffer.from(value))))matches.push(file);}
assert.deepEqual(matches,[], 'Known credential appeared in Git-visible files: '+matches.join(', '));
if(existsSync('.env'))assert.equal(execFileSync('git',['check-ignore','.env']).toString().trim(),'.env');
const examples=readFileSync('.env.example','utf8').split('\n').filter(Boolean);assert.ok(examples.every(line=>/^[A-Z_]+=$/.test(line)));
assert.ok(!files.some(f=>f.startsWith('data/')||f.startsWith('.env')&&f!=='.env.example'));
console.log(JSON.stringify({gitVisibleFiles:files.length,knownCredentialValuesChecked:credentials.length,knownCredentialMatches:matches.length,exampleValues:'all empty',privateData:'excluded'}));
