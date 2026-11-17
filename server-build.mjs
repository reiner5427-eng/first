import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('index.html','utf8').replace(/\r\n/g,'\n');
const prefix='const QUESTION_BANK = ';
const line=html.split('\n').find(s=>s.startsWith(prefix));
assert.ok(line,'Question bank missing from standalone HTML');
const questions=JSON.parse(line.slice(prefix.length).replace(/;\s*$/,''));
const rulesPrefix='const CHECKPOINT_RULES = ';
const rulesLine=html.split('\n').find(s=>s.startsWith(rulesPrefix));
assert.ok(rulesLine,'Checkpoint rules missing from standalone HTML');
const rules=JSON.parse(rulesLine.slice(rulesPrefix.length).replace(/;\s*$/,''));
assert.equal(questions.length,100,'Expected 100 questions');
assert.equal(new Set(questions.map(q=>q.prompt)).size,100,'Question prompts must be unique');
const nicknameFilter=html.split('/* NICKNAME_FILTER_START */\n')[1]?.split('\n/* NICKNAME_FILTER_END */')[0];
assert.ok(nicknameFilter, 'Nickname filter missing from standalone HTML');
const assets={
  '/':['text/html; charset=utf-8',html],
  '/assets/jua.woff2':['font/woff2',readFileSync('assets/jua.woff2').toString('base64'),true],
  '/assets/jua-OFL.txt':['text/plain; charset=utf-8',readFileSync('assets/jua-OFL.txt','utf8')]
};
mkdirSync('dist/server',{recursive:true});
writeFileSync('dist/server/index.js',`const QUESTIONS=${JSON.stringify(questions)};\nconst CHECKPOINT_RULES=${JSON.stringify(rules)};\nconst ASSETS=${JSON.stringify(assets)};\n`+nicknameFilter+'\n'+readFileSync('worker.mjs','utf8'));
console.log('Cloudflare Worker build ready:',questions.length,'questions');
