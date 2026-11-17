/* Cloudflare Worker + D1. Dedicated DB: never connect this to the original quiz DB. */
const COATS = new Set(['cheese','mackerel','white','gray','tuxedo']);
const PAGES_ORIGIN = 'https://reiner5427-eng.github.io';
const safeName = entered => typeof entered === 'string' && !nicknameError(entered) ? entered.normalize('NFKC').trim() : null;
const shuffle = xs => {for(let i=xs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[xs[i],xs[j]]=[xs[j],xs[i]];}return xs;};
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const fail=(error,status=400)=>json({error},status);
function decodeDeck(game){const deck=JSON.parse(game.deck);return deck;}
const result=(game,dist)=>({finished:true,score:dist*10+game.correct_count*100,distance:dist,correctCount:game.correct_count,lives:Math.max(0,3-game.mistakes)});
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
