"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const FiveDB = require("../rapfi/5db-format.js");
const source = fs.readFileSync("rapfi/vcf-5db-cloud.js", "utf8");
const record = {
  width:15,height:15,mode:"record",nextSide:1,
  title:"棋盤內的標題",board:Array(225).fill(0),currentPath:[],
  root:{move:-1,stone:0,text:"",marks:[],children:[]},
};
const calls=[];
const storage=new Map([["vcf_google_auth_token_v1","test-token"]]);
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const fetch=async (url,options={})=>{
  calls.push({url:String(url),options});
  if(String(url).includes("auth_me")) return {ok:true,status:200,json:async()=>({ok:true,user:{email:"test@example.com"}})};
  if(String(url).includes("public_config")) return {ok:true,status:200,json:async()=>({ok:true,google_client_id:""})};
  if(String(url).includes("action=save")) return {ok:true,status:200,json:async()=>({ok:true,id:1})};
  throw Error("unmocked "+url);
};
const window={
  VCFWorkbenchRecord:{workspace:()=>({mode:"record"}),export5DBDocument:()=>{
    return structuredClone(record);
  }},
  FiveDB,
  addEventListener(){},
};
const document={getElementById:()=>null};
vm.runInNewContext(source,{window,document,localStorage,fetch,URLSearchParams,AbortController,
 setTimeout,clearTimeout,TextEncoder,TextDecoder,Date,Uint8Array,Blob,console}, {filename:"vcf-5db-cloud.js"});
(async()=>{
  await window.VCFCloud5DB.authMe();
  await window.VCFCloud5DB.saveCurrent("下載檔案名稱");
  const call=calls.find(x=>x.url.includes("action=save"));
  assert.ok(call,"save endpoint called");
  const url=new URL(call.url,"https://example.test");
  assert.equal(url.searchParams.get("file_name"),"下載檔案名稱");
  assert.equal(url.searchParams.get("title"),"棋盤內的標題");
  assert.equal(FiveDB.decode(call.options.body).title,"棋盤內的標題");
  assert.equal(call.options.headers["X-5DB-Preview"], "15x15:"+"0".repeat(225),
    "save sends a tiny precomputed position instead of requiring a full file download");
  assert.equal(record.title,"棋盤內的標題","no mutation");
  await window.VCFCloud5DB.saveCurrent("另一名稱.5db");
  const next=new URL(calls.at(-1).url,"https://example.test");
  assert.equal(next.searchParams.get("file_name"),"另一名稱");
  assert.equal(next.searchParams.get("title"),"棋盤內的標題");
  console.log("5DB cloud file name and embedded title remain independent");
})().catch(error=>{console.error(error);process.exitCode=1});
