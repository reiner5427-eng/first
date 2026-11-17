import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {LEADERBOARD_RESET_AT} from './dist/server/index.js';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync('schema.sql','utf8'));
const env={DB:{prepare(sql){return{bind(...args){const stmt=db.prepare(sql);return{first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args)}} ,all:async()=>({results:db.prepare(sql).all()})}}}};
const call=async(path,data)=>{const response=await worker.fetch(new Request('https://game.test'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),env);return [response.status,await response.json()];};
test('game assets, blocked nicknames, new game and server-side score',async()=>{
 assert.equal((await worker.fetch(new Request('https://game.test/'),env)).status,200);
 for(const nickname of ['ebola', '바보냥이', '탱크', '공산친구', '손정보', '딱딱'])assert.equal((await call('/api/start',{nickname,coat:'gray'}))[0],400,nickname);
 const [status,started]=await call('/api/start',{nickname:'국어냥이',coat:'gray'});
 assert.equal(status,200);assert.ok(started.id);
 db.prepare('UPDATE runs SET started=? WHERE id=?').run(Date.now()-120_000,started.id);
 let [s,q]=await call('/api/checkpoint',{id:started.id,distance:15});assert.equal(s,200);assert.equal(q.question.choices.length,4);
 let [s2,q2]=await call('/api/checkpoint',{id:started.id,distance:15});assert.equal(s2,200);assert.deepEqual(q2,q);
 const active=db.prepare('SELECT active_order FROM runs WHERE id=?').get(started.id);
 const answer=JSON.parse(active.active_order).indexOf(0);
 const [a,result]=await call('/api/answer',{id:started.id,choice:answer});assert.equal(a,200);assert.equal(result.correct,true);assert.equal(result.lives,3);
 assert.equal((await call('/api/answer',{id:started.id,choice:answer}))[0],409);
 assert.equal((await call('/api/checkpoint',{id:started.id,distance:45}))[0],400);
 [s,q]=await call('/api/checkpoint',{id:started.id,distance:30});assert.equal(s,200);
 const order=JSON.parse(db.prepare('SELECT active_order FROM runs WHERE id=?').get(started.id).active_order);
 const [wrongStatus,wrong]=await call('/api/answer',{id:started.id,choice:(order.indexOf(0)+1)%4});assert.equal(wrongStatus,200);assert.equal(wrong.correct,false);assert.equal(wrong.lives,2);
 const [finishStatus,finished]=await call('/api/finish',{id:started.id,distance:29});assert.equal(finishStatus,200);assert.equal(finished.score,400);
 db.prepare('UPDATE runs SET started=? WHERE id=?').run(LEADERBOARD_RESET_AT - 1, started.id);
 assert.deepEqual((await call('/api/ranking'))[1], []);
 db.prepare('UPDATE runs SET started=? WHERE id=?').run(LEADERBOARD_RESET_AT, started.id);
 assert.equal((await call('/api/ranking'))[1][0].nickname,'국어냥이');
 assert.equal((await call('/api/ranking'))[1][0].score,400);
});

test('leaderboard returns the best 200 unique nicknames in descending score', async()=>{
 const insert=db.prepare('INSERT INTO runs(id,nickname,coat,started,deck,finished,score,max_distance) VALUES(?,?,?,?,?,1,?,?)');
 for(let i=1;i<=220;i++)insert.run('rank'+i,'국어냥이'+i,'cheese',LEADERBOARD_RESET_AT+i,'[]',i*10,i);
 insert.run('duplicate','국어냥이220','gray',LEADERBOARD_RESET_AT+99999,'[]',1,1);
 const [status,rows]=await call('/api/ranking');
 assert.equal(status,200); assert.equal(rows.length,200);
 assert.equal(rows[0].nickname,'국어냥이220');
 assert.equal(rows[0].score,2200);
 assert.equal(rows[199].score,220);
 assert.equal(rows.filter(x=>x.nickname==='국어냥이220').length,1);
});

test('timed booths award one arrival bonus, pause for quizzes, and end late approaches', async()=>{
 const [status,{id,remainingMs}]=await call('/api/start',{nickname:'시간냥이',coat:'gray',timed:true});
 assert.equal(status,200);
 assert.ok(remainingMs>14000&&remainingMs<=15000);
 const get=()=>db.prepare('SELECT * FROM runs WHERE id=?').get(id);
 const setTravelTime=ms=>db.prepare('UPDATE runs SET started=?,segment_started=? WHERE id=?')
  .run(Date.now()-120000,Date.now()-ms,id);
 const answerIndex=()=>JSON.parse(get().active_order).indexOf(0);

 setTravelTime(4000);
 const [arrival,repeated]=await Promise.all([
  call('/api/checkpoint',{id,distance:15,elapsedMs:4000}),
  call('/api/checkpoint',{id,distance:15,elapsedMs:4000})
 ]);
 assert.equal(arrival[0],200);
 assert.deepEqual(repeated,arrival);
 assert.equal(arrival[1].bonusScore,50);
 assert.equal(get().bonus_score,50);
 assert.equal(get().segment_started,0);
 assert.equal((await call('/api/advance',{id,distance:15}))[0],409);

 const [,wrong]=await call('/api/answer',{id,choice:(answerIndex()+1)%4});
 assert.equal(wrong.lives,2);
 const [,retry]=await call('/api/checkpoint',{id,distance:15});
 assert.equal(retry.bonusScore,50);
 assert.equal((await call('/api/answer',{id,choice:answerIndex()}))[1].correct,true);
 assert.equal((await call('/api/checkpoint',{id,distance:30}))[0],409);

 const [,next]=await call('/api/advance',{id,distance:15});
 assert.ok(next.remainingMs>14000&&next.remainingMs<=15000);
 const nextStart=get().segment_started;
 assert.equal((await call('/api/advance',{id,distance:15}))[0],200);
 assert.equal(get().segment_started,nextStart);
 setTravelTime(12000);
 const [,second]=await call('/api/checkpoint',{id,distance:30,elapsedMs:12000});
 assert.equal(second.bonusScore,50);
 assert.equal((await call('/api/answer',{id,choice:answerIndex()}))[1].correct,true);

 assert.equal((await call('/api/advance',{id,distance:30}))[0],200);
 setTravelTime(16000);
 const [,tooLate]=await call('/api/checkpoint',{id,distance:45,elapsedMs:14900});
 assert.deepEqual(tooLate,{expired:true});
 const [,finished]=await call('/api/finish',{id,distance:45});
 assert.equal(finished.distance,44);
 assert.equal(finished.bonusScore,50);
 assert.equal(finished.score,690);
 assert.deepEqual((await call('/api/finish',{id,distance:45}))[1],finished);
});

test('checkpoint migration preserves earlier finished scores',()=>{
 const existing=new DatabaseSync(':memory:');
 existing.exec(readFileSync('drizzle/0000_runs.sql','utf8'));
 existing.prepare('INSERT INTO runs(id,nickname,coat,started,deck,finished,score) VALUES(?,?,?,?,?,1,?)')
  .run('existing-record','고양이','gray',1,'[]',635);
 existing.exec(readFileSync('drizzle/0001_checkpoint_timing.sql','utf8'));
 const row=existing.prepare('SELECT score,segment_started,bonus_score FROM runs WHERE id=?').get('existing-record');
 assert.equal(row.score,635);
 assert.equal(row.segment_started,null);
 assert.equal(row.bonus_score,0);
 existing.close();
});
