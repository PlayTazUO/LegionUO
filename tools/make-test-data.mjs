import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-data');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const w16 = (v) => { const b=Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const w32 = (v) => { const b=Buffer.alloc(4); b.writeUInt32LE(v>>>0); return b; };
const c16 = (r,g,b) => ((r>>3)<<10)|((g>>3)<<5)|(b>>3);

// ---------- hues.mul ----------
{
  const groups = 375;
  const buf = Buffer.alloc(groups*708);
  for (let g=0; g<groups; g++) {
    let o = g*708;
    buf.writeUInt32LE(0, o); o+=4;
    for (let e=0;e<8;e++) {
      for (let i=0;i<32;i++) {
        const v = c16(i*8, (i*3+g)%256, 255-i*7);
        buf.writeUInt16LE(v, o); o+=2;
      }
      buf.writeUInt16LE(0,o); o+=2; buf.writeUInt16LE(31,o); o+=2;
      buf.write('hue', o); o+=20;
    }
  }
  fs.writeFileSync(path.join(dir,'hues.mul'), buf);
}

// ---------- tiledata.mul ----------
{
  const landGroups=512, staticGroups=104;
  const landSize=4+32*(8+2+20), staticSize=4+32*(8+1+1+4+2+2+2+1+20);
  const buf=Buffer.alloc(landGroups*landSize + staticGroups*staticSize);
  let o=0;
  for (let g=0; g<landGroups; g++) {
    o+=4;
    for (let i=0;i<32;i++) {
      const id=g*32+i;
      buf.writeBigUInt64LE(0n,o); o+=8;
      buf.writeUInt16LE(0,o); o+=2;
      buf.write(`land ${id}`,o,'latin1'); o+=20;
    }
  }
  for (let g=0; g<staticGroups; g++) {
    o+=4;
    for (let i=0;i<32;i++) {
      const id=g*32+i;
      buf.writeBigUInt64LE(0n,o); o+=8;
      buf.writeUInt8(1,o); o+=1;
      buf.writeUInt8(0,o); o+=1;
      buf.writeInt32LE(1,o); o+=4;
      buf.writeUInt16LE(0,o); o+=2;
      buf.writeUInt16LE(0,o); o+=2;
      buf.writeUInt16LE(0,o); o+=2;
      buf.writeUInt8(20,o); o+=1;
      buf.write(`static ${id}`,o,'latin1'); o+=20;
    }
  }
  fs.writeFileSync(path.join(dir,'tiledata.mul'), buf);
}

// ---------- art.mul / artidx.mul ----------
function landDiamond(color) {
  const raw = Buffer.alloc(2024);
  let at=0;
  for (let i=0;i<22;i++) {
    const start=22-(i+1), end=start+((i+1)<<1);
    for (let j=start;j<end;j++) { raw.writeUInt16LE(color,at); at+=2; }
  }
  for (let i=0;i<22;i++) {
    const end=i+((22-i)<<1);
    for (let j=i;j<end;j++) { raw.writeUInt16LE(color,at); at+=2; }
  }
  return raw;
}
function staticArt(w,h,color) {
  const header=Buffer.alloc(8);
  header.writeUInt32LE(0,0); header.writeInt16LE(w,4); header.writeInt16LE(h,6);
  const table=Buffer.alloc(h*2);
  const rows=Buffer.alloc(h*(4 + w*2 + 4));
  let ro=0;
  for (let y=0;y<h;y++) {
    table.writeUInt16LE(ro>>1, y*2);
    rows.writeUInt16LE(0,ro); rows.writeUInt16LE(w,ro+2); ro+=4;
    for (let x=0;x<w;x++) { rows.writeUInt16LE(color,ro); ro+=2; }
    rows.writeUInt16LE(0,ro); rows.writeUInt16LE(0,ro+2); ro+=4;
  }
  return Buffer.concat([header,table,rows]);
}
{
  const count=0x4000+0x0F00;
  const idx=Buffer.alloc(count*12);
  const chunks=[]; let off=0;
  const add=(index,data)=>{ idx.writeUInt32LE(off,index*12); idx.writeInt32LE(data.length,index*12+4); idx.writeInt32LE((44<<16)|44,index*12+8); chunks.push(data); off+=data.length; };
  add(0, landDiamond(c16(40,120,50)));
  add(1, landDiamond(c16(70,140,70)));
  add(2, landDiamond(c16(40,90,150)));
  add(0x4000+0x0eed, staticArt(12,10,c16(230,190,40)));
  add(0x4000+0x0eee, staticArt(16,12,c16(230,190,40)));
  add(0x4000+0x0eef, staticArt(20,14,c16(230,190,40)));
  add(0x4000+0x0cd3, staticArt(24,46,c16(30,120,40)));
  add(0x4000+0x0e75, staticArt(18,28,c16(120,80,40)));
  // leave all other land tiles mapping to tile 0? Not needed.
  fs.writeFileSync(path.join(dir,'artidx.mul'), idx);
  fs.writeFileSync(path.join(dir,'art.mul'), Buffer.concat(chunks));
}

// ---------- gumps ----------
function gumpArt(w,h,color) {
  const rowLen = 4 + 2*w;
  const rowLookup=Buffer.alloc(h*4);
  const rows=Buffer.alloc(h*(4 + w*2));
  let ro=0;
  for (let y=0;y<h;y++) {
    rowLookup.writeUInt32LE(ro>>2, y*4);
    rows.writeUInt16LE(color,ro); rows.writeUInt16LE(w,ro+2); ro+=4;
    for (let x=0;x<w;x++) { rows.writeUInt16LE(0,ro); ro+=2; }
  }
  return Buffer.concat([rowLookup,rows]);
}
{
  const count=0x0b00;
  const idx=Buffer.alloc(count*12);
  const chunks=[]; let off=0;
  const add=(index,data,w,h)=>{ idx.writeUInt32LE(off,index*12); idx.writeInt32LE(data.length,index*12+4); idx.writeInt32LE((w<<16)|h,index*12+8); chunks.push(data); off+=data.length; };
  for (let i=0;i<9;i++) add(0x0a3c+i, gumpArt(8,8,c16(120,100,70)), 8,8);
  add(0x0048, gumpArt(220,200,c16(60,48,30)), 220,200);
  add(0x0049, gumpArt(220,200,c16(60,48,30)), 220,200);
  add(0x003e, gumpArt(220,200,c16(60,48,30)), 220,200);
  add(0x006e, gumpArt(24,24,c16(180,160,90)),24,24);
  add(0x006f, gumpArt(24,24,c16(90,180,120)),24,24);
  add(0x00d0, gumpArt(24,24,c16(160,80,80)),24,24);
  add(0x00d1, gumpArt(24,24,c16(80,120,160)),24,24);
  add(0x0906, gumpArt(200,160,c16(70,60,40)),200,160);
  fs.writeFileSync(path.join(dir,'gumpidx.mul'), idx);
  fs.writeFileSync(path.join(dir,'gumpart.mul'), Buffer.concat(chunks));
}

// ---------- map0 + statics ----------
{
  const mapW=7168,mapH=4096;
  const blocksX=mapW>>3, blocksY=mapH>>3;
  const size=blocksX*blocksY*196;
  const fd=fs.openSync(path.join(dir,'map0.mul'),'w');
  fs.ftruncateSync(fd,size);
  // create statics for blocks around 1000,1000
  const staticChunks=[]; let staticOff=0;
  const staidx=Buffer.alloc(blocksX*blocksY*12);
  for (let bx=120;bx<=135;bx++) for (let by=120;by<=135;by++) {
    const block=bx*blocksY+by;
    const cellBuf=Buffer.alloc(196);
    for (let i=0;i<64;i++) {
      const x=i&7,y=i>>3;
      const tile=(x+y)%2?1:0;
      cellBuf.writeUInt16LE(tile,4+i*3);
      cellBuf.writeInt8(0,4+i*3+2);
    }
    fs.writeSync(fd, cellBuf, 0, 196, block*196);
    // one tree at local 4,4
    const rec=Buffer.alloc(7);
    rec.writeUInt16LE(0x0cd3,0); rec.writeUInt8(4,2); rec.writeUInt8(4,3); rec.writeInt8(0,4); rec.writeUInt16LE(0,5);
    staidx.writeUInt32LE(staticOff, block*12); staidx.writeUInt32LE(7, block*12+4); staidx.writeUInt32LE(0, block*12+8);
    staticChunks.push(rec); staticOff+=7;
  }
  fs.closeSync(fd);
  fs.writeFileSync(path.join(dir,'staidx0.mul'), staidx);
  fs.writeFileSync(path.join(dir,'statics0.mul'), Buffer.concat(staticChunks));
}

// ---------- radarcol.mul ----------
{
  const count=0x14000;
  const buf=Buffer.alloc(count*2);
  const set=(index,color)=>buf.writeUInt16LE(color,index*2);
  for (let i=0;i<0x4000;i++) set(i, c16(40+(i%20), 80+((i*3)%40), 40+(i%10)));
  set(0, c16(50,120,60));
  set(1, c16(80,150,80));
  set(2, c16(40,90,150));
  set(0x4000+0x0eed, c16(230,190,40));
  set(0x4000+0x0cd3, c16(30,140,50));
  set(0x4000+0x0e75, c16(150,100,50));
  fs.writeFileSync(path.join(dir,'radarcol.mul'), buf);
}

// ---------- facet00.mul ----------
{
  const mapW=7168,mapH=4096;
  const chunks=[w16(mapW), w16(mapH)];
  for (let y=0;y<mapH;y++) {
    if (y<960 || y>=1088) { chunks.push(w32(0)); continue; }
    const runs=[];
    for (let x=0;x<mapW;x+=64) {
      const size=Math.min(64,mapW-x);
      const inside=x+size>960 && x<1088;
      const color=inside ? (((x>>6)+(y>>6))%2 ? c16(60,130,70) : c16(80,150,90)) : 0;
      runs.push(Buffer.from([size]), w16(color));
    }
    const row=Buffer.concat(runs);
    chunks.push(w32(row.length), row);
  }
  fs.writeFileSync(path.join(dir,'facet00.mul'), Buffer.concat(chunks));
}

// ---------- skills ----------
{
  const names=['Alchemy','Anatomy','Swordsmanship'];
  const idx=Buffer.alloc(names.length*12);
  const chunks=[]; let off=0;
  names.forEach((name,i)=>{
    const data=Buffer.concat([Buffer.from([1]), Buffer.from(name,'latin1'), Buffer.from([0])]);
    idx.writeUInt32LE(off,i*12); idx.writeInt32LE(data.length,i*12+4);
    chunks.push(data); off+=data.length;
  });
  fs.writeFileSync(path.join(dir,'skills.idx'), idx);
  fs.writeFileSync(path.join(dir,'skills.mul'), Buffer.concat(chunks));
}

// ---------- cliloc ----------
{
  const entries=[[1000000,'LegionUO test message'],[1040000,'Welcome, traveler.'],[1051000,'Test Cliloc']];
  const header=Buffer.alloc(6);
  const chunks=[header];
  for (const [id,text] of entries) {
    const t=Buffer.from(text,'utf8');
    const e=Buffer.alloc(7+t.length);
    e.writeInt32LE(id,0); e.writeUInt8(0,4); e.writeInt16LE(t.length,5); t.copy(e,7);
    chunks.push(e);
  }
  fs.writeFileSync(path.join(dir,'Cliloc.enu'), Buffer.concat(chunks));
}

// ---------- anim.mul / anim.idx ----------
{
  function frameBlock(w,h,color) {
    const palette=Buffer.alloc(512);
    for (let i=0;i<256;i++) palette.writeUInt16LE(c16(i,i,Math.min(255,i*2)),i*2);
    const frame=Buffer.alloc(8 + 4 + w*2 + 4);
    frame.writeInt16LE(0,0); frame.writeInt16LE(-h,2); frame.writeInt16LE(w,4); frame.writeInt16LE(h,6);
    frame.writeUInt32LE(w,8); // header: run=w, x=0, y=0
    for (let x=0;x<w;x++) frame.writeUInt8(40+(x%10),12+x);
    frame.writeUInt32LE(0x7fff7fff, 12+w*2);
    const head=Buffer.alloc(8);
    head.writeUInt32LE(1,0); // frame count
    head.writeUInt32LE(8,4); // frame offset relative to dataStart (512)
    return Buffer.concat([palette,head,frame]);
  }
  const peopleOffset=35000*12;
  const idx=Buffer.alloc(peopleOffset + 35*5*12 + 12);
  const dataBlocks=[Buffer.alloc(4)];
  let off=4;
  const block=frameBlock(22,44,0);
  const actionCount=35;
  for (let action=0;action<actionCount;action++) {
    for (let d=0;d<5;d++) {
      const entry=peopleOffset + (action*5+d)*12;
      if (action===0 || action===4) {
        idx.writeUInt32LE(off,entry); idx.writeUInt32LE(block.length,entry+4);
      }
    }
  }
  dataBlocks.push(block);
  fs.writeFileSync(path.join(dir,'anim.idx'), idx);
  fs.writeFileSync(path.join(dir,'anim.mul'), Buffer.concat(dataBlocks));
}


// ---------- fonts.mul ----------
{
  const glyphs=[];
  for (let i=0;i<224;i++) {
    const w=4,h=6;
    const data=Buffer.alloc(w*h*2);
    for (let p=0;p<w*h;p++) data.writeUInt16LE(0x7fff,p*2);
    glyphs.push(Buffer.from([w,h,0]), data);
  }
  const font=Buffer.concat([Buffer.from([0]), ...glyphs]);
  fs.writeFileSync(path.join(dir,'fonts.mul'), font);
}

// ---------- sound.mul / soundidx.mul ----------
{
  const sampleRate=22050;
  const samples=1102;
  const pcm=Buffer.alloc(samples*2);
  for (let i=0;i<samples;i++) pcm.writeInt16LE(Math.round(Math.sin(i/8)*6000), i*2);
  const header=Buffer.alloc(44);
  header.write('RIFF',0,'ascii'); header.writeUInt32LE(36+pcm.length,4); header.write('WAVE',8,'ascii');
  header.write('fmt ',12,'ascii'); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20);
  header.writeUInt16LE(1,22); header.writeUInt32LE(sampleRate,24); header.writeUInt32LE(sampleRate*2,28);
  header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36,'ascii');
  header.writeUInt32LE(pcm.length,40);
  const wav=Buffer.concat([header,pcm]);
  const count=32;
  const idx=Buffer.alloc(count*12);
  const chunks=[]; let off=0;
  for (let i=0;i<count;i++) {
    idx.writeUInt32LE(off,i*12); idx.writeUInt32LE(wav.length,i*12+4); idx.writeUInt32LE(0,i*12+8);
    chunks.push(wav); off+=wav.length;
  }
  fs.writeFileSync(path.join(dir,'soundidx.mul'), idx);
  fs.writeFileSync(path.join(dir,'sound.mul'), Buffer.concat(chunks));
}

// A tiny map layout override is not needed; 7168x4096 fits.
console.log('test data written to', dir);
