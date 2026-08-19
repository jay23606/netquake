// Regression: a MOVETYPE_BOUNCE + SOLID_NOT entity whose box has a NONZERO hull offset
// (clip_mins - mins != 0) must LAND on the floor, not drift by the offset every airborne
// frame. This reproduces the "gib head / post-death view falls into the void" bug: ThrowHead
// gives the head mins_z=0 -> hull1 offset z=-24, and clipToWorld failed to re-add the offset
// on a NO-HIT trace (fraction==1), so the head drifted +24/frame and never landed.
//
// The bug hid from world.test because players/monsters have mins_z == hull1 clip_mins_z (-24)
// -> offset 0. This test explicitly exercises the OFFSET-nonzero case, dilated hulls and all.
//
// Needs build/sim.wasm + build/id1_progs.dat (gitignored; extract_progs.mjs from id1/pak0.pak).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadProgs } from './progsLoader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_EDICTS = 512;
const F = { MOVETYPE:8, SOLID:9, ORIGIN:10, ORIGIN1:11, ORIGIN2:12, VELOCITY2:18,
  MINS:33, MINS1:34, MINS2:35, MAXS:36, MAXS1:37, MAXS2:38, NEXTTHINK:46, HEALTH:48, FLAGS:76 };
const SOLID_NOT=0, SOLID_BSP=4, MT_BOUNCE=10, FL_ONGROUND=512, EMPTY=-1, SOLID=-2;

const wasmBytes = readFileSync(join(HERE,'..','build','sim.wasm'));
const imports = { env:{abort:(m,f,l,c)=>{throw new Error('abort @'+l+':'+c);}},
    // DEFAULT-NS: full host-import namespace defaults (later keys in this literal override).
    vm: { isServerLoading: () => 0, hostError: () => {} },
    strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
    host: new Proxy({ host_pow: Math.pow }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
    builtins_move: { host_random: () => 0, host_sin: Math.sin, host_cos: Math.cos },
    builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
    builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
    svphysics: { host_watersplash: () => {}, host_hitsound: () => {} },
    svpusher: { host_sin: Math.sin, host_cos: Math.cos },
    svclient: { host_sin: Math.sin, host_cos: Math.cos },
  vm:{isServerLoading:()=>0, hostError:()=>{}}, strings:{host_tostring:()=>0,host_tofixed1:()=>0} };
const inst = await WebAssembly.instantiate(wasmBytes,
  new Proxy(imports,{get:(t,k)=>(k in t?t[k]:new Proxy({},{get:()=>()=>0})),has:()=>true}));
const x = inst.instance.exports;

// hollow room (empty inside, solid outside) -- the INVERSE of the harness's solid-block makeBoxHull
function room(lo, hi, clipBase, planeBase){
  const dist=[hi[0],lo[0],hi[1],lo[1],hi[2],lo[2]]; const nodes=[], planes=[];
  for(let i=0;i<=5;i++){
    const node={idx:clipBase+i, planenum:planeBase+i, children:[0,0]};
    node.children[1-(i&1)]=(i!==5)?(clipBase+i+1):EMPTY; node.children[i&1]=SOLID; nodes.push(node);
    const normal=[0,0,0]; normal[i>>1]=1.0; planes.push({idx:planeBase+i, type:i>>1, normal, dist:dist[i]});
  }
  return {nodes, planes, first:clipBase, last:clipBase+5};
}

loadProgs(x, readFileSync(join(HERE,'..','build','id1_progs.dat')), MAX_EDICTS);
x.initStringTemp();
const LO=[-1024,-1024,-1024], HI=[1024,1024,1024];
const cmin1=[-16,-16,-24], cmax1=[16,16,32], cmin2=[-32,-32,-24], cmax2=[32,32,64];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const h0=room(LO,HI,0,0), h1=room(sub(LO,cmin1),sub(HI,cmax1),6,6), h2=room(sub(LO,cmin2),sub(HI,cmax2),12,12);
for(const h of [h0,h1,h2]) for(const p of h.planes) x.setPlane(p.idx,p.normal[0],p.normal[1],p.normal[2],p.dist,p.type);
for(const n of h0.nodes) x.setClipNode(n.idx,n.planenum,n.children[0],n.children[1]);
x.setHullMeta(h0.first,h0.last);
for(const n of h1.nodes) x.setClipNode12(n.idx,n.planenum,n.children[0],n.children[1]);
for(const n of h2.nodes) x.setClipNode12(n.idx,n.planenum,n.children[0],n.children[1]);
x.installHull1(h1.first,h1.last,cmin1[0],cmin1[1],cmin1[2]);
x.installHull2(h2.first,h2.last,cmin2[0],cmin2[1],cmin2[2]);
for(const hid of [0,1,2]) x.installModelHull(0,hid,h0.first,h0.last,0,0,0);
x.pusherSetWorldHullRange(h0.first,h0.last);
x.initAreaTree(-2048,-2048,-2048,2048,2048,2048,MAX_EDICTS);
x.initPusherState(MAX_EDICTS); x.initEntState(0,0);
x.setMaxVelocity(2000); x.setGravityCvar(800); x.setGravityFieldIdx(-1);
x.setMaxSpeed(320); x.setAccelerateCvar(10); x.setFrictionCvar(4); x.setEdgeFrictionCvar(2); x.setStopSpeedCvar(100); x.setNoStep(0);
x.initModelPrecache();

const setf=(e,i,v)=>x.edStoreFloat(e,i,v);
function drop(mn, mx, startZ, expectFloorZ){
  for(let e=0;e<2;e++) x.setEdictFree(e,0);
  setf(0,F.SOLID,SOLID_BSP); setf(0,F.MOVETYPE,0); setf(0,F.ORIGIN,0); setf(0,F.ORIGIN1,0); setf(0,F.ORIGIN2,0);
  for(const i of [F.MINS,F.MINS1,F.MINS2,F.MAXS,F.MAXS1,F.MAXS2]) setf(0,i,0);
  setf(1,F.ORIGIN,0); setf(1,F.ORIGIN1,0); setf(1,F.ORIGIN2,startZ);
  setf(1,F.MINS,mn[0]);setf(1,F.MINS1,mn[1]);setf(1,F.MINS2,mn[2]); setf(1,F.MAXS,mx[0]);setf(1,F.MAXS1,mx[1]);setf(1,F.MAXS2,mx[2]);
  setf(1,F.SOLID,SOLID_NOT); setf(1,F.MOVETYPE,MT_BOUNCE); setf(1,F.VELOCITY2,-100); setf(1,F.NEXTTHINK,-1); setf(1,F.HEALTH,-99); setf(1,F.FLAGS,0);
  x.setNumEdicts(2); x.linkEdict(0); x.linkEdict(1);
  let time=0; const dt=1/72;
  for(let fr=0;fr<600;fr++){
    x.setServerTime(time); x.physicsFrame(time,dt);
    const oz=x.edLoadFloat(1,F.ORIGIN2), ong=(x.edLoadFloat(1,F.FLAGS)&FL_ONGROUND)?1:0;
    if(ong) return {ok:Math.abs(oz-expectFloorZ)<1, oz, fr};
    if(oz>500 || oz<-1200) return {ok:false, oz, fr, drifted:oz>500}; // drifted up (bug) or tunneled
    time+=dt;
  }
  return {ok:false, oz:x.edLoadFloat(1,F.ORIGIN2), fr:600, nolanding:true};
}

let pass=true;
// player box: offset 0 (control) -> lands at oz -1000 (feet at world floor -1024)
const p = drop([-16,-16,-24],[16,16,32], -900, -1000);
console.log(`[${p.ok?'PASS':'FAIL'}] player box (offset 0) settles @oz=${p.oz.toFixed(1)} f${p.fr}` + (p.drifted?' DRIFTED-UP':''));
pass = pass && p.ok;
// head box: mins_z=0 -> hull1 offset z=-24 -> the regression -> lands at oz -1024 (box bottom on floor)
const h = drop([-16,-16,0],[16,16,56], -900, -1024);
console.log(`[${h.ok?'PASS':'FAIL'}] head box (offset z=-24) settles @oz=${h.oz.toFixed(1)} f${h.fr}` + (h.drifted?' DRIFTED-UP-(the-bug)':''));
pass = pass && h.ok;

console.log(pass ? 'hulloffset: OK' : 'hulloffset: FAILED');
process.exit(pass ? 0 : 1);
