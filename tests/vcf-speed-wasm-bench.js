"use strict";
// The same deployed WASM modules in one Node runtime. Test branch only.
const path=require("node:path"), {performance}=require("node:perf_hooks");
const bitDir=path.resolve(".cache/vcf-bitboard-engine");
const rapfiDir=path.resolve(".cache/rapfi-vcf-standalone");
const DEPTH=15, LIMIT=40000, BATCH=40, TRIALS=5;
const median=a=>{const v=[...a].sort((x,y)=>x-y);return (v[(v.length-1)>>1]+v[v.length>>1])/2};
const put=(b,x,y,c)=>b[y*15+x]=c;
function deep7(){
  const b=new Uint8Array(225);
  for(const x of [8,9,10])put(b,x,7,1);
  for(const [x,y,c] of [[11,7,2],[7,5,1],[7,6,1],[7,8,2],[5,4,1],[6,4,1],
                        [8,4,2],[4,5,1],[4,6,1],[9,8,2],[5,3,2],[6,5,2]])put(b,x,y,c);
  return b;
}
function noise7(){
  const b=deep7();
  for(const [x,y,c] of [[1,1,1],[2,2,2],[12,12,1],[13,13,2]])put(b,x,y,c);
  return b;
}
function open4(){const b=new Uint8Array(225);for(let x=5;x<=8;x++)put(b,x,7,1);return b}
function rotate(src,code){
  const out=new Uint8Array(225);
  for(let y=0;y<15;y++)for(let x=0;x<15;x++){
    let a=code>=4?14-x:x,b=y;
    for(let i=0;i<code%4;i++)[a,b]=[14-b,a];
    out[b*15+a]=src[y*15+x];
  }
  return out;
}
async function main(){
  const bc=require(path.join(bitDir,"vcf-bitboard-engine.js"));
  const rc=require(path.join(rapfiDir,"rapfi-vcf-standalone.js"));
  const [bb,rp]=await Promise.all([
    bc({locateFile:f=>path.join(bitDir,f)}),
    rc({locateFile:f=>path.join(rapfiDir,f)})
  ]);
  const bm={board:bb._malloc(225),moves:bb._malloc(224*64),
            lengths:bb._malloc(128),stats:bb._malloc(16)};
  const rm={board:rp._malloc(225),moves:rp._malloc(225),stats:rp._malloc(28)};
  if(Object.values({...bm,...rm}).some(v=>!v))throw Error("WASM malloc failed");
  const big=(heap,i)=>heap[i]+heap[i+1]*4294967296;
  const runBitboard=(board,rule)=>{
    bb.HEAPU8.set(board,bm.board);
    bb.HEAPU16.fill(0,bm.lengths>>>1,(bm.lengths>>>1)+64);
    const found=bb._vcfBbFindModeV3(bm.board,1,rule,0,0,0,1,DEPTH,LIMIT,
                                   bm.moves,bm.lengths,224,bm.stats);
    const v=new DataView(bb.HEAPU8.buffer,bm.stats,16);
    return {found:found>0,nodes:v.getUint32(0,true),
            engineMs:v.getUint32(4,true)/1000,aborted:Boolean(v.getUint8(14)),
            routeLength:found>0?bb.HEAPU16[bm.lengths>>>1]:0};
  };
  const runRapfi=(board,rule)=>{
    rp.HEAPU8.set(board,rm.board);
    const found=rp._rapfiStandaloneVCF(rm.board,1,rule,LIMIT,DEPTH,rm.moves,rm.stats);
    const i=rm.stats>>>2,h=rp.HEAPU32;
    return {found:found>0,nodes:big(h,i),
            engineMs:big(h,i+2)/1000,aborted:Boolean(h[i+5]),
            routeLength:found>0?h[i+6]:0};
  };
  function measure(run,board,rule){
    for(let i=0;i<2;i++)run(board,rule);
    const walls=[],engines=[];
    let ref=null;
    for(let i=0;i<TRIALS;i++){
      const start=performance.now();let inside=0;
      for(let j=0;j<BATCH;j++){
        const x=run(board,rule);inside+=x.engineMs;
        if(ref===null)ref=x;
        if(x.found!==ref.found||x.nodes!==ref.nodes||x.aborted!==ref.aborted)
          throw Error("Nondeterministic engine result");
      }
      walls.push((performance.now()-start)/BATCH);
      engines.push(inside/BATCH);
    }
    return {...ref,wallMs:median(walls),engineMs:median(engines)};
  }
  console.log("BEGIN_VCF_WASM_BENCH trials=5 batch=40 warmups=2 symmetries=8 maxNodes=40000 maxDepth=15");
  const fixtures=[["deep7_free",deep7(),0],["deep7_renju",deep7(),2],
                  ["deep7_noise",noise7(),0],["open4_free",open4(),0]];
  let same=0,complete=0;
  for(const [name,base,rule] of fixtures)for(let sym=0;sym<8;sym++){
    const board=rotate(base,sym);
    const b=measure(runBitboard,board,rule),r=measure(runRapfi,board,rule);
    same+=Number(b.found===r.found);
    complete+=Number(!b.aborted&&!r.aborted);
    const values={fixture:name,sym,rule,
      bb_found:Number(b.found),rp_found:Number(r.found),
      bb_abort:Number(b.aborted),rp_abort:Number(r.aborted),
      bb_wall_ms:b.wallMs.toFixed(5),rp_wall_ms:r.wallMs.toFixed(5),
      bb_engine_ms:b.engineMs.toFixed(5),rp_engine_ms:r.engineMs.toFixed(5),
      bb_nodes:b.nodes,rp_nodes:r.nodes,
      wall_speedup_bb_over_rp:(b.wallMs/r.wallMs).toFixed(3),
      bb_route:b.routeLength,rp_route:r.routeLength};
    console.log("WASM_BENCH "+Object.entries(values).map(([k,v])=>k+"="+v).join(" "));
  }
  console.log("WASM_SUMMARY same_found="+same+" complete="+complete+" total=32");
}
main().catch(e=>{console.error(e);process.exitCode=1});
