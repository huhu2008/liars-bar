import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.addInitScript(() => {
  localStorage.setItem('liars-bar:save', JSON.stringify({
    game: { seat:0, round:3, phase:'turn', targetRank:'K', tableCard:null,
      players:[{seat:0,name:'你',hand:[{id:'KH',rank:'K',suit:'H'}],alive:true,isBot:false},
               {seat:1,name:'狡狐',hand:[],alive:true,isBot:true},
               {seat:2,name:'鸦先生',hand:[],alive:true,isBot:true},
               {seat:3,name:'屠夫',hand:[],alive:true,isBot:true}],
      turnSeat:0, bullets:2, deck:[], discard:[], publicCards:[], log:[],
      liesBySeat:[0,0,0,0], correctChallenges:[0,0,0,0],
      pendingPlay:null, lastReveal:null, winnerSeat:null, roundWinnerSeat:null },
    characterId: 'raven', playerCount: 4, at: Date.now(),
  }));
});
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const txt = await p.evaluate(() => document.body.innerText);
console.log('显示存档信息:', /未完成的对局/.test(txt) ? '✅' : '❌');
console.log('显示角色名:', /鸦先生 · 第 3 轮/.test(txt) ? '✅ 鸦先生 · 第 3 轮' : '❌');
console.log('有放弃按钮:', /放弃这局/.test(txt) ? '✅' : '❌');
console.log('入座按钮隐藏:', !/以「.*」入座/.test(txt) ? '✅' : '❌ 仍显示');
// 试着点其他角色（应该无效）
const before = await p.evaluate(() => document.querySelector('[data-picked]')?.getAttribute('data-picked') ?? '');
await p.getByText('小猫·米拉').first().click().catch(() => {});
await p.waitForTimeout(400);
const after = await p.evaluate(() => document.body.innerText.includes('小猫·米拉 · 第'));
console.log('点其他角色后仍是存档角色:', !after ? '✅ 锁定' : '❌ 被切换');
await p.screenshot({ path: '/tmp/save-lock.png' });
await b.close();
