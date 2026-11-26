/**
 * 浏览器端到端冒烟(治理 1.11)。
 * 运行:`npx playwright test`(配置见 playwright.config.ts:自动构建 +
 * vite preview;浏览器为系统 Chrome channel,免浏览器下载)。
 * `sessionStorage('fly-rate')` 为记录在案的测试钩子:回放倍速,正常用户恒为 1。
 */
import {test, expect, type Page} from '@playwright/test';

const BASE = 'http://localhost:4173/';

async function gotoWorkshop(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('fly-rate', '10'));
  await page.goto(BASE, {waitUntil: 'domcontentloaded'});
  await page.evaluate(() => localStorage.clear());
  await page.reload({waitUntil: 'domcontentloaded'});
  await expect(page.locator('h2')).toContainText('从一张纸开始');
}

/** 进度信号:一次正式投掷提交完成(回看横幅或操作行的下一位按钮出现)。 */
async function waitThrowCommitted(page: Page) {
  await expect(page.locator('#comp-next-turn, #comp-review-next').first()).toBeVisible({timeout: 20000});
}

async function quickFoldAndFly(page: Page) {
  await page.locator('#start').click();
  await page.locator('#finish-fold').click();
  await page.locator('#next').click();
  await expect(page.locator('#throw')).toBeVisible();
}

test.describe('FoldFly 端到端冒烟', () => {
  test('路径1:选纸→选机型→跳过折叠→投掷→落地结算', async ({page}) => {
    await gotoWorkshop(page);
    await page.locator('[data-weight="100"]').click();
    await page.locator('[data-plane="suzanne"]').click();
    await quickFoldAndFly(page);
    await page.locator('#throw').click();
    await expect(page.locator('.flight-status')).toContainText('试飞完成', {timeout: 15000});
    for (let i = 0; i < 3; i++) {
      await expect(page.locator('.results div').nth(i)).toContainText(/[0-9]/);
    }
  });

  test('路径2/3:改风滑块后投掷生效(过期闭包回归 C-02)', async ({page}) => {
    await gotoWorkshop(page);
    await quickFoldAndFly(page);
    await page.locator('#wind').fill('-4');
    await page.locator('#wind').dispatchEvent('input');
    await page.locator('#throw').click();
    await expect(page.locator('.flight-status')).toContainText('试飞完成', {timeout: 15000});
    await expect(page.locator('.results div').first()).toContainText(/[0-9]/);
  });

  test('路径4:暂停/恢复/重新投掷', async ({page}) => {
    await gotoWorkshop(page);
    await quickFoldAndFly(page);
    await page.locator('#throw').click();
    await page.locator('#pause-flight').click();
    await expect(page.locator('#pause-flight')).toContainText('继续飞行');
    await page.locator('#pause-flight').click();
    await expect(page.locator('.flight-status')).toContainText('试飞完成', {timeout: 15000});
    await page.locator('#throw').click();
    await expect(page.locator('.flight-status')).toContainText('试飞完成', {timeout: 15000});
  });

  test('路径5:分享链接生成且重开后复现', async ({page}) => {
    await gotoWorkshop(page);
    await quickFoldAndFly(page);
    await page.locator('#throw').click();
    await expect(page.locator('.flight-status')).toContainText('试飞完成', {timeout: 15000});
    await page.locator('#share').click();
    const hash = await page.evaluate(() => location.hash);
    expect(hash.startsWith('#flight=')).toBe(true);
    await page.goto(BASE + hash, {waitUntil: 'domcontentloaded'});
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect(page.locator('h2')).toContainText('给它一次飞行');
    await expect(page.locator('.shared-result')).toContainText('当前模型可复现');
  });

  test('路径1.3 注入回归:恶意选手名不注入 DOM', async ({page}) => {
    await gotoWorkshop(page);
    await quickFoldAndFly(page);
    await page.locator('#mode-comp').click();
    await page.locator('#comp-ev-duration').click();
    await page.locator('[data-comp-name="0"]').fill('"><img src=x onerror=window.__pwned=1>');
    await page.locator('#comp-start').click();
    expect(await page.evaluate(() => (window as unknown as {__pwned?: boolean}).__pwned ?? false)).toBe(false);
    await expect(page.locator('.comp-banner')).toContainText('"><img', {useInnerText: true});
  });

  test('路径6/8:两人三回合比赛、中途退赛、重新开始', async ({page}) => {
    await gotoWorkshop(page);
    await quickFoldAndFly(page);
    await page.locator('#mode-comp').click();
    await page.locator('[data-comp-count="2"]').click();
    await page.locator('#comp-start').click();
    // 一投后中途退赛
    await page.locator('#throw').click();
    await waitThrowCommitted(page);
    await page.locator('#comp-next-turn').click();
    await page.locator('#comp-abort').click();
    await expect(page.locator('#comp-start')).toBeVisible();
    // 重新开始并打完全场(6 投;最后一次下一位点击会把完赛比赛推进到结算页)
    await page.locator('#comp-start').click();
    for (let i = 0; i < 6; i++) {
      await page.locator('#throw').click();
      await waitThrowCommitted(page);
      await page.locator('#comp-next-turn').click();
      if ((await page.locator('h2').textContent())?.includes('正式比赛排行榜')) break;
    }
    await expect(page.locator('h2')).toContainText('正式比赛排行榜');
    await expect(page.locator('.standings-table tbody tr')).toHaveCount(2);
  });

  test('路径7:四人比赛完成与排名唯一性', async ({page}) => {
    await gotoWorkshop(page);
    await quickFoldAndFly(page);
    await page.locator('#mode-comp').click();
    await page.locator('[data-comp-count="4"]').click();
    await page.locator('#comp-start').click();
    for (let i = 0; i < 12; i++) {
      await page.locator('#throw').click();
      await waitThrowCommitted(page);
      await page.locator('#comp-next-turn').click();
      if ((await page.locator('h2').textContent())?.includes('正式比赛排行榜')) break;
    }
    await expect(page.locator('.standings-table tbody tr')).toHaveCount(4);
  });

  test('路径9:个人最佳持久化(刷新后仍在)', async ({page}) => {
    await gotoWorkshop(page);
    await quickFoldAndFly(page);
    await page.locator('#throw').click();
    await expect(page.locator('.flight-status')).toContainText('试飞完成', {timeout: 15000});
    await expect(page.locator('.flight-status .mono')).not.toContainText('—');
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.locator('#start').click();
    await page.locator('#finish-fold').click();
    await page.locator('#next').click();
    await expect(page.locator('.flight-status .mono')).toContainText(/m|s/);
    await expect(page.locator('.flight-status .mono')).not.toContainText('—');
  });

  test('路径10:320px 窄屏基本流程可用', async ({page}) => {
    await page.setViewportSize({width: 320, height: 700});
    await gotoWorkshop(page);
    await page.locator('#start').click();
    await page.locator('#finish-fold').click();
    await page.locator('#next').click();
    await page.locator('#throw').click();
    await expect(page.locator('.flight-status')).toContainText('试飞完成', {timeout: 20000});
  });
});
