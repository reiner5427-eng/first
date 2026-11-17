/* Cloudflare Worker + D1. Dedicated DB: never connect this to the original quiz DB. */
const COATS = new Set(['cheese','mackerel','white','gray','tuxedo']);
const PAGES_ORIGIN = 'https://reiner5427-eng.github.io';
const {limitMs, bonusMs, bonusPoints} = CHECKPOINT_RULES;
const ARRIVAL_TRANSIT_MS = 350;
const safeName = entered => typeof entered === 'string' && !nicknameError(entered) ? entered.normalize('NFKC').trim() : null;
const shuffle = xs => {for(let i=xs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[xs[i],xs[j]]=[xs[j],xs[i]];}return xs;};
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const fail=(error,status=400)=>json({error},status);
function decodeDeck(game){const deck=JSON.parse(game.deck);return deck;}
const result=game=>({finished:true,score:game.score,distance:game.max_distance,correctCount:game.correct_count,lives:Math.max(0,3-game.mistakes),
 ...(game.segment_started===null?{}:{bonusScore:game.bonus_score})});
const segmentWindow=started=>({remainingMs:Math.max(0,limitMs-(Date.now()-started))});
const roundById=(db,id)=>db.prepare('SELECT * FROM runs WHERE id=?').bind(id).first();
function arrivedWithin(serverElapsed, clientElapsed, threshold) {
 return serverElapsed<=threshold ||
  (Number.isFinite(clientElapsed) && clientElapsed>=0 && clientElapsed<=threshold &&
   serverElapsed<=threshold+ARRIVAL_TRANSIT_MS);
}
async function endpoint(request,db,path){
 if(path==='/api/ranking' && request.method==='GET'){
  const {results}=await db.prepare(`WITH unique_runs AS (
   SELECT nickname, coat, score, max_distance, started, id,
    ROW_NUMBER() OVER (PARTITION BY nickname COLLATE NOCASE ORDER BY score DESC, started ASC, id) AS n
   FROM runs WHERE finished=1 AND score>0
  ) SELECT nickname,coat,score,max_distance AS distance FROM unique_runs WHERE n=1 ORDER BY score DESC,started ASC,id LIMIT 200`).all();
  return json(results.filter(row=>safeName(row.nickname)));
 }
 if(request.method!=='POST')return fail('지원하지 않는 요청입니다.',405);
 let body;try{const s=await request.text();if(s.length>1024)throw Error();body=JSON.parse(s);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return fail('요청을 읽을 수 없습니다.');}
 if(path==='/api/start'){
  const nickname=safeName(body.nickname);if(!nickname)return fail('사용할 수 없는 닉네임입니다.');
  const coat=body.coat;if(!COATS.has(coat))return fail('고양이 종류가 올바르지 않습니다.');
  const id=crypto.randomUUID(),deck=shuffle(Array.from({length:QUESTIONS.length},(_,i)=>i));
  const started=Date.now(), segment=body.timed===true?started:null;
  await db.prepare('INSERT INTO runs (id,nickname,coat,started,deck,segment_started) VALUES (?,?,?,?,?,?)')
   .bind(id,nickname,coat,started,JSON.stringify(deck),segment).run();
  return json(segment===null?{id}:{id,...segmentWindow(segment)});
 }
 if(typeof body.id!=='string'||!/^[-a-f0-9]{36}$/i.test(body.id))return fail('게임을 찾을 수 없습니다.');
 const game=await roundById(db,body.id);if(!game)return fail('게임을 찾을 수 없습니다.',404);
 const timed=game.segment_started!==null;
 if(path==='/api/finish'){
  if(game.finished)return json(result(game));
  const d=Number(body.distance);
  if(!Number.isInteger(d)||d<0)return fail('올바른 거리 값이 아닙니다.');
  // Unlocked checkpoints cap the highest plausible distance.
  const ceiling=(game.checkpoints+1)*15-(timed?1:0);
  // The score is bounded on the server, not trusted directly from the browser.
  const timeCeiling=Math.floor((Date.now()-game.started)/65)+2;
  const distance=Math.min(d,ceiling,timeCeiling);
  const saved=await db.prepare(`UPDATE runs SET finished=1,
   score=MAX(max_distance,?)*10+correct_count*100+bonus_score,max_distance=MAX(max_distance,?)
   WHERE id=? AND finished=0 RETURNING *`).bind(distance,distance,game.id).first();
  return json(result(saved??await roundById(db,game.id)));
 }
 if(game.finished)return fail('이미 종료된 게임입니다.',409);
 if(path==='/api/advance'){
  const distance=body.distance;
  if(!timed||game.checkpoints===0||distance!==game.checkpoints*15||game.max_distance!==distance||
     game.active_question!==null)return fail('현재 부스의 퀴즈를 먼저 풀어 주세요.',409);
  const next=await db.prepare(`UPDATE runs
   SET segment_started=CASE WHEN segment_started=0 THEN ? ELSE segment_started END
   WHERE id=? AND finished=0 AND checkpoints=? AND max_distance=? AND active_question IS NULL
   RETURNING segment_started`).bind(Date.now(),game.id,game.checkpoints,distance).first();
  return next?json(segmentWindow(next.segment_started)):fail('다음 구간을 시작할 수 없습니다.',409);
 }
 if(path==='/api/checkpoint'){
  const distance=Number(body.distance);
  if(!Number.isInteger(distance)||distance!==15*(game.checkpoints+1))return fail('체크포인트 순서가 올바르지 않습니다.');
  if(distance>Math.floor((Date.now()-game.started)/65)+5)return fail('이동 속도를 확인할 수 없습니다.');
  let booth=game;
  if(game.active_question===null){
   let bonus=0;
   if(timed&&game.max_distance<distance){
    if(!game.segment_started)return fail('다음 구간을 먼저 시작해 주세요.',409);
    const elapsed=Date.now()-game.segment_started;
    if(!arrivedWithin(elapsed,body.elapsedMs,limitMs))return json({expired:true});
    if(arrivedWithin(elapsed,body.elapsedMs,bonusMs))bonus=bonusPoints;
   }
   const deck=decodeDeck(game), current=deck[game.question_step%deck.length];
   const order=JSON.stringify(shuffle([0,1,2,3]));
   booth=await db.prepare(`UPDATE runs SET active_question=?,active_order=?,question_step=question_step+1,
    max_distance=MAX(max_distance,?),bonus_score=bonus_score+?,
    segment_started=CASE WHEN segment_started IS NULL THEN NULL ELSE 0 END
    WHERE id=? AND finished=0 AND active_question IS NULL AND question_step=? AND checkpoints=? RETURNING *`)
    .bind(current,order,distance,bonus,game.id,game.question_step,game.checkpoints).first();
   booth??=await roundById(db,game.id);
   if(booth.finished||booth.checkpoints!==game.checkpoints||booth.active_question===null)return fail('부스의 상태가 바뀌었어요.',409);
  }
  const q=QUESTIONS[booth.active_question],indexes=JSON.parse(booth.active_order);
  return json({question:{topic:q.topic,prompt:q.prompt,choices:indexes.map(i=>q.choices[i])},
   ...(timed?{bonusScore:booth.bonus_score}:{})});
 }
 if(path==='/api/answer'){
  if(game.active_question===null||!game.active_order)return fail('풀고 있는 문제가 없습니다.',409);
  const choice=Number(body.choice);if(!Number.isInteger(choice)||choice<0||choice>3)return fail('보기를 선택해 주세요.');
  const order=JSON.parse(game.active_order),isCorrect=order[choice]===0;
  const q=QUESTIONS[game.active_question];
  const mistakes=game.mistakes+(isCorrect?0:1),count=game.correct_count+(isCorrect?1:0),checkpoints=game.checkpoints+(isCorrect?1:0),finished=mistakes>=3?1:0;
  const score=game.max_distance*10+count*100+game.bonus_score;
  const updated=await db.prepare(`UPDATE runs SET mistakes=?,correct_count=?,checkpoints=?,active_question=NULL,
   active_order=NULL,finished=?,score=? WHERE id=? AND finished=0 AND active_question=? AND question_step=? RETURNING id`)
   .bind(mistakes,count,checkpoints,finished,score,game.id,game.active_question,game.question_step).first();
  if(!updated)return fail('이미 처리한 답변입니다.',409);
  return json({correct:isCorrect,correctIndex:order.indexOf(0),lives:Math.max(0,3-mistakes),explanation:q.explanation,finished:!!finished});
 }
 return fail('존재하지 않는 기능입니다.',404);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/api/')){
   const origin=request.headers.get('origin');
   const fromPages=origin===PAGES_ORIGIN;
   if(origin && origin!==url.origin && !fromPages)return fail('잘못된 요청입니다.',403);
   if(request.method==='OPTIONS'){
    if(!fromPages)return new Response(null,{status:405});
    return new Response(null,{status:204,headers:{
     'access-control-allow-origin':PAGES_ORIGIN,
     'access-control-allow-methods':'GET, POST',
     'access-control-allow-headers':'content-type',
     'vary':'Origin'
    }});
   }
   let response;
   try{
    response=env?.DB ? await endpoint(request,env.DB,path) : fail('공유 순위 서버가 연결되지 않았습니다.',503);
   }catch{
    response=fail('서버 오류가 발생했습니다.',500);
   }
   response.headers.set('vary','Origin');
   if(fromPages)response.headers.set('access-control-allow-origin',PAGES_ORIGIN);
   return response;
  }
  const asset=ASSETS[path]||ASSETS[path==='/'?'/':'/'];if(!asset)return new Response('Not found',{status:404});
  const [type,content,base64]=asset;
  const body=base64 ? Uint8Array.from(atob(content), char=>char.charCodeAt(0)) : content;
  return new Response(body,{headers:{'content-type':type,'cache-control':path==='/'?'no-store':'public,max-age=120'}});
 }
};
