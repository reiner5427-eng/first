/* Cloudflare Worker + D1. Dedicated DB: never connect this to the original quiz DB. */
const BLOCK_KO = /씨발|시발|병신|븅신|좆|존나|지랄|새끼|야동|섹스|일베|일간베스트|운지|홍어충|느금|니애미|니에미|꼬치|바보|탱크|공산|정보|12월|딱|손|도박|카지노|나치|히틀러|시진핑|스탈린|노무현|자살|자해|죽고싶|마약|담배|똥|응가|방귀|지렁이|아이큐|자유시간|빼빼로|쮸쮸|못생|추하|사랑해|엄마|제발|실패|실업자|백수|싫어|미워|여친|남친|커플|소주|맥주|대마|필로폰/;
const BLOCK_EN = /fuck|shit|bitch|porn|sex|ilbe|ebola|nazi|hitler|suicid|cocaine|cannabis|gambl|casino|gambling|murder|kimochi|gimotti/;
const COATS = new Set(['cheese','mackerel','white','gray','tuxedo']);
const safeName = entered => {
 if(typeof entered!=='string')return null;
 const s=entered.normalize('NFKC').trim();const normalized=s.toLowerCase().replace(/[\p{Cf}\p{M}\s_.-]/gu,'');
 const kor=normalized.replace(/[^가-힣]/g,'');const eng=normalized.replace(/[^a-z0-9]/g,'').replace(/[013457]/g,x=>({0:'o',1:'i',3:'e',4:'a',5:'s',7:'t'}[x]));
 return /^[가-힣a-zA-Z0-9_ ]{2,12}$/.test(s) && /\p{L}/u.test(s) && !BLOCK_KO.test(kor)&&!BLOCK_EN.test(eng) ? s : null;
};
const shuffle = xs => {for(let i=xs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[xs[i],xs[j]]=[xs[j],xs[i]];}return xs;};
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store','access-control-allow-origin':'same-origin'}});
const fail=(error,status=400)=>json({error},status);
function decodeDeck(game){const deck=JSON.parse(game.deck);return deck;}
const result=(game,dist)=>({finished:true,score:dist*10+game.correct_count*100,distance:dist,correctCount:game.correct_count,lives:Math.max(0,3-game.mistakes)});
async function endpoint(request,db,path){
 if(path==='/api/ranking' && request.method==='GET'){
  const {results}=await db.prepare(`WITH unique_runs AS (
   SELECT nickname, coat, score, max_distance, started,
    ROW_NUMBER() OVER (PARTITION BY nickname COLLATE NOCASE ORDER BY score DESC, started ASC) AS n
   FROM runs WHERE finished=1 AND score>0
  ) SELECT nickname,coat,score,max_distance AS distance FROM unique_runs WHERE n=1 ORDER BY score DESC,started ASC LIMIT 200`).all();
  return json(results.filter(row=>safeName(row.nickname)));
 }
 if(request.method!=='POST')return fail('지원하지 않는 요청입니다.',405);
 const origin=request.headers.get('origin');if(origin && origin!==new URL(request.url).origin)return fail('잘못된 요청입니다.',403);
 let body;try{const s=await request.text();if(s.length>1024)throw Error();body=JSON.parse(s);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return fail('요청을 읽을 수 없습니다.');}
 if(path==='/api/start'){
  const nickname=safeName(body.nickname);if(!nickname)return fail('사용할 수 없는 닉네임입니다.');
  const coat=body.coat;if(!COATS.has(coat))return fail('고양이 종류가 올바르지 않습니다.');
  const id=crypto.randomUUID(),deck=shuffle(Array.from({length:QUESTIONS.length},(_,i)=>i));
  await db.prepare('INSERT INTO runs (id,nickname,coat,started,deck) VALUES (?,?,?,?,?)').bind(id,nickname,coat,Date.now(),JSON.stringify(deck)).run();
  return json({id});
 }
 if(typeof body.id!=='string'||!/^[-a-f0-9]{36}$/i.test(body.id))return fail('게임을 찾을 수 없습니다.');
 const game=await db.prepare('SELECT * FROM runs WHERE id=?').bind(body.id).first();if(!game)return fail('게임을 찾을 수 없습니다.',404);
 if(path==='/api/finish'){
  if(game.finished)return json(result(game,game.max_distance));
  const d=Number(body.distance);
  if(!Number.isInteger(d)||d<0)return fail('올바른 거리 값이 아닙니다.');
  // Unlocked checkpoints cap the highest plausible distance.
  const ceiling=(game.checkpoints+1)*15;
  // The score is bounded on the server, not trusted directly from the browser.
  const timeCeiling=Math.floor((Date.now()-game.started)/65)+2;
  const distance=Math.max(game.max_distance,Math.min(d,ceiling,timeCeiling));
  const score=distance*10+game.correct_count*100;
  await db.prepare('UPDATE runs SET finished=1,score=?,max_distance=? WHERE id=? AND finished=0').bind(score,distance,game.id).run();
  return json({...result(game,distance),score});
 }
 if(game.finished)return fail('이미 종료된 게임입니다.',409);
 if(path==='/api/checkpoint'){
  const distance=Number(body.distance);
  if(!Number.isInteger(distance)||distance!==15*(game.checkpoints+1))return fail('체크포인트 순서가 올바르지 않습니다.');
  if(distance>Math.floor((Date.now()-game.started)/65)+5)return fail('이동 속도를 확인할 수 없습니다.');
  let current=game.active_question, order=game.active_order;
  if(current===null){
   const deck=decodeDeck(game);current=deck[game.question_step%deck.length];order=JSON.stringify(shuffle([0,1,2,3]));
   await db.prepare('UPDATE runs SET active_question=?,active_order=?,question_step=question_step+1,max_distance=MAX(max_distance,?) WHERE id=?')
   .bind(current,order,distance,game.id).run();
  }
  const q=QUESTIONS[current],indexes=JSON.parse(order);
  return json({question:{topic:q.topic,prompt:q.prompt,choices:indexes.map(i=>q.choices[i])}});
 }
 if(path==='/api/answer'){
  if(game.active_question===null||!game.active_order)return fail('풀고 있는 문제가 없습니다.',409);
  const choice=Number(body.choice);if(!Number.isInteger(choice)||choice<0||choice>3)return fail('보기를 선택해 주세요.');
  const order=JSON.parse(game.active_order),isCorrect=order[choice]===0;
  const q=QUESTIONS[game.active_question];
  const mistakes=game.mistakes+(isCorrect?0:1),count=game.correct_count+(isCorrect?1:0),checkpoints=game.checkpoints+(isCorrect?1:0),finished=mistakes>=3?1:0;
  const score=game.max_distance*10+count*100;
  await db.prepare('UPDATE runs SET mistakes=?,correct_count=?,checkpoints=?,active_question=NULL,active_order=NULL,finished=?,score=? WHERE id=? AND active_question=?')
   .bind(mistakes,count,checkpoints,finished,score,game.id,game.active_question).run();
  return json({correct:isCorrect,correctIndex:order.indexOf(0),lives:Math.max(0,3-mistakes),explanation:q.explanation,finished:!!finished});
 }
 return fail('존재하지 않는 기능입니다.',404);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/api/')){
   if(!env?.DB)return fail('공유 순위 서버가 연결되지 않았습니다.',503);
   try{return await endpoint(request,env.DB,path);}catch(err){return fail('서버 오류가 발생했습니다.',500);}
  }
  const asset=ASSETS[path]||ASSETS[path==='/'?'/':'/'];if(!asset)return new Response('Not found',{status:404});
  const [type,content]=asset;
  return new Response(content,{headers:{'content-type':type,'cache-control':path==='/'?'no-store':'public,max-age=120'}});
 }
};
