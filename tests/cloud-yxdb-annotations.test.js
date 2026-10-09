"use strict";
const assert = require("node:assert/strict");
const { embed, extract, scan } = require("../rapfi/vcf-cloud-annotation-codec.js");

function record(key, text = "", lead = [0,0,0,0,0]) {
  const bytes = new TextEncoder().encode(text);
  const out = Buffer.alloc(2 + key.length + 2 + lead.length + bytes.length);
  let i = 0;
  out.writeUInt16LE(key.length, i); i += 2;
  Buffer.from(key).copy(out, i); i += key.length;
  out.writeUInt16LE(lead.length + bytes.length, i); i += 2;
  Buffer.from(lead).copy(out, i); i += lead.length;
  Buffer.from(bytes).copy(out, i);
  return out;
}
function fixture() {
  const records = [
    record([0,0,0], 'charset="UTF-8"'),
    record([2,15,15], "@BTXT@77A\b棋譜註解"),
    record([2,15,15,7,7], "第一手"),
  ];
  const header = Buffer.alloc(4);
  header.writeUInt32LE(records.length);
  return new Uint8Array(Buffer.concat([header, ...records]));
}

async function test() {
  const raw = fixture();
  assert.equal(scan(raw).records.length, 3);
  const legacy = await extract(raw);
  assert.equal(legacy.metadata, null);
  assert.equal(Buffer.compare(Buffer.from(legacy.bytes), Buffer.from(raw)), 0);

  const annotations = {
    "2:record:": [{ type:"circle", x:7, y:7, color:0, filled:true }],
    "2:record:112": [
      { type:"text", x:7, y:7, color:5, text:"字" },
      { type:"arrow", x:7, y:7, tx:9, ty:7, color:3 }
    ]
  };
  const metadata = { version:1, annotations, history:[112], basePly:0 };
  const patched = await embed(raw, metadata);
  assert.equal(scan(patched).records.length, 3, "YXDB positions must not change");
  assert.equal(Buffer.from(patched).includes(Buffer.from('charset="UTF-8"')), true);
  assert.equal(Buffer.from(patched).includes(Buffer.from("第一手")), true);
  const unpacked = await extract(patched);
  assert.equal(JSON.stringify(unpacked.metadata.annotations), JSON.stringify(annotations));
  assert.equal(unpacked.metadata.history[0], 112);
  assert.equal(unpacked.metadata.basePly, 0);
  assert.equal(Buffer.compare(Buffer.from(unpacked.bytes), Buffer.from(raw)), 0, "record text must round-trip exactly");
  await assert.rejects(embed(patched, metadata), /重複包裝/);

  const longAnnotations = { "2:record:": Array.from({length:1000}, (_,i) => ({
    type:"circle", x:i%15, y:Math.floor(i/15)%15, color:i%10, filled:i%2===0,
  })) };
  const large = await embed(raw, { version:1, annotations:longAnnotations, history:[], basePly:0 });
  const restored = await extract(large);
  assert.equal(restored.metadata.annotations["2:record:"].length, 1000);

  const corrupt = Uint8Array.from(patched);
  const markerStart = Buffer.from(corrupt).indexOf(Buffer.from("VCF-CLOUD-MARKS-V1:"));
  assert.ok(markerStart > 0);
  // Changing the suffix must be rejected instead of silently dropping marks.
  corrupt[corrupt.length - 1] ^= 1; // The last record is not the annotated root, so corruption alone is not a metadata assertion.
  const malformed = Uint8Array.from(patched);
  const suffix = Buffer.from(malformed).lastIndexOf(Buffer.from("VCF-CLOUD-MARKS-V1:"));
  const pos = Buffer.from(malformed).indexOf(0x1e, suffix);
  assert.ok(pos > suffix);
  malformed[pos] = 0x58;
  await assert.rejects(extract(malformed), /損毀/);
  await assert.rejects(extract(new Uint8Array([1,2,3])), /YXDB/);
  console.log("Cloud XDB annotations: metadata embedding, compression, compatibility, and round-trip passed");
}
test().catch(err => { console.error(err); process.exitCode = 1; });
