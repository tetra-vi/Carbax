// Browser end-to-end walkthrough of the ComplyBridge UI against the local harness.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const shots = path.join(__dirname, 'shots');
require('fs').mkdirSync(shots, { recursive: true });
const file = (n) => path.join(__dirname, 'files', n);
if (!require('fs').existsSync(path.join(__dirname, 'files'))) require('./make-test-files');
const log = (...a) => console.log('•', ...a);

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
  log('screenshot', name);
}

async function register(page, name, email) {
  await page.goto(BASE + '/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Passw0rd!demo');
  await page.getByRole('button', { name: 'Create account' }).click();
}

async function uploadAndConfirm(page, fname) {
  await page.goto(BASE + '/documents');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.locator('input[type=file]').setInputFiles(file(fname));
  await page.waitForURL(/\/documents\/doc_/, { timeout: 30000 });
  await page.getByRole('button', { name: 'Confirm values' }).waitFor();
  return page;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));

  // 1. Landing page
  await page.goto(BASE + '/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await shot(page, '01-landing');

  // 2. Owner registers and onboards the company
  await register(page, 'Ravi Perera', 'ravi@lanka-alu.test');
  await page.waitForURL(/onboarding/);
  await page.getByLabel('Company name').fill('Lanka Aluminium Works');
  await shot(page, '02-onboarding');
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.waitForURL(/facilities/);

  // 3. Facility and reporting periods
  await page.getByLabel('Facility name').fill('Biyagama Extrusion Plant');
  await page.getByLabel('Location').fill('Biyagama');
  await page.getByRole('button', { name: 'Add facility' }).last().click();
  await page.getByText('Biyagama Extrusion Plant').first().waitFor();
  for (const m of ['2026-02', '2026-03']) {
    await page.getByLabel('Month').fill(m);
    await page.getByRole('button', { name: 'Open period' }).click();
    await page.getByRole('cell', { name: m }).waitFor();
  }
  await shot(page, '03-facilities');

  // 4. February evidence: upload, AI extraction, human confirmation
  const selectPeriod = async (key) => {
    await page.getByRole('combobox', { name: 'Reporting period' }).click();
    await page.getByRole('option', { name: new RegExp(key) }).click();
  };
  await page.goto(BASE + '/documents');
  await selectPeriod('2026-02');
  for (const f of ['feb-electricity.pdf', 'feb-diesel.pdf', 'feb-production.pdf']) {
    await uploadAndConfirm(page, f);
    if (f === 'feb-diesel.pdf') await shot(page, '04-review-extraction');
    await page.getByRole('button', { name: 'Confirm values' }).click();
    await page.getByText(/issue\(s\) resolved/).waitFor();
  }
  // 5. March: diesel (with a human correction) + production, electricity missing
  await page.goto(BASE + '/documents');
  await selectPeriod('2026-03');
  await uploadAndConfirm(page, 'mar-diesel.pdf');
  const qty = page.getByLabel('Quantity');
  await qty.fill('950');
  await page.getByRole('button', { name: 'Confirm values' }).click();
  await page.getByText(/issue\(s\) resolved/).waitFor();
  await uploadAndConfirm(page, 'mar-production.pdf');
  await page.getByRole('button', { name: 'Confirm values' }).click();
  await page.getByText(/issue\(s\) resolved/).waitFor();
  await page.goto(BASE + '/documents');
  await shot(page, '05-documents');

  // 6. Invite a Tamil-speaking worker and a reviewer
  const invite = async (email, role) => {
    await page.goto(BASE + '/team');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('combobox', { name: 'Role' }).click();
    await page.getByRole('option', { name: role }).click();
    await page.getByRole('button', { name: 'Create invitation' }).click();
    const link = await page.locator('code.break').innerText();
    return link.trim();
  };
  const workerLink = await invite('priya@lanka-alu.test', 'Factory worker');
  const reviewerLink = await invite('anita@lanka-alu.test', 'Compliance reviewer');
  await shot(page, '06-team');

  const worker = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })).newPage();
  worker.on('pageerror', (e) => errors.push('worker pageerror: ' + e.message));
  await worker.goto(workerLink);
  await worker.getByRole('button', { name: 'Create account' }).click();
  await worker.getByLabel('Your name').fill('Priya');
  await worker.getByLabel('Email').fill('priya@lanka-alu.test');
  await worker.getByLabel('Password').fill('Passw0rd!demo');
  await worker.getByRole('button', { name: 'Create account' }).click();
  await worker.waitForURL(/invite/);
  await worker.getByRole('combobox', { name: 'Language' }).click();
  await worker.getByRole('option', { name: /Tamil/ }).click();
  await worker.getByRole('button', { name: 'Join the company' }).click();
  await worker.waitForURL(/guided|tasks/, { timeout: 20000 });

  const reviewer = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  reviewer.on('pageerror', (e) => errors.push('reviewer pageerror: ' + e.message));
  await reviewer.goto(reviewerLink);
  await reviewer.getByRole('button', { name: 'Create account' }).click();
  await reviewer.getByLabel('Your name').fill('Anita');
  await reviewer.getByLabel('Email').fill('anita@lanka-alu.test');
  await reviewer.getByLabel('Password').fill('Passw0rd!demo');
  await reviewer.getByRole('button', { name: 'Create account' }).click();
  await reviewer.waitForURL(/invite/);
  await reviewer.getByRole('button', { name: 'Join the company' }).click();
  await reviewer.waitForURL(/dashboard/, { timeout: 20000 });

  // 7. CarbonOps: detect missing March electricity, Gemini agent drafts the request, owner approves
  await page.goto(BASE + '/carbonops');
  await selectPeriod('2026-03');
  await page.getByRole('button', { name: 'Check evidence now' }).click();
  await page.getByText('No confirmed electricity bill for March 2026.').first().waitFor();
  await page.getByRole('button', { name: 'Run CarbonOps Autopilot' }).click();
  await page.getByRole('button', { name: 'Approve and send' }).first().waitFor({ timeout: 20000 });
  await shot(page, '07-carbonops-draft');
  await page.getByRole('button', { name: 'Approve and send' }).first().click();
  await page.getByText('Request sent to the assignee').waitFor();

  // 8. Worker (Tamil, guided mobile) sees the task and uploads the missing bill
  await worker.goto(BASE + '/guided');
  await worker.getByRole('link', { name: /புகைப்படம்/ }).waitFor({ timeout: 20000 });
  await shot(worker, '08-worker-guided-tamil');
  await worker.getByRole('link', { name: /புகைப்படம்/ }).click();
  await worker.locator('input[type=file]').setInputFiles(file('mar-electricity-photo.pdf'));
  await worker.waitForURL(/\/documents\/doc_/, { timeout: 30000 });
  await worker.getByRole('button', { name: 'மதிப்புகளை உறுதிசெய்' }).waitFor();
  await shot(worker, '09-worker-confirm-tamil');
  await worker.getByRole('button', { name: 'மதிப்புகளை உறுதிசெய்' }).click();
  await worker.getByText(/பிரச்சினை\(கள்\) தீர்ந்தன/).waitFor();

  // 9. Owner: task resolved automatically, results, dashboard
  await page.goto(BASE + '/carbonops');
  await page.getByText('Resolved').first().waitFor();
  await shot(page, '10-carbonops-resolved');
  await page.goto(BASE + '/results');
  await page.getByText('Calculation lines').waitFor();
  await shot(page, '11-results');
  await page.goto(BASE + '/dashboard');
  await page.getByText('Monthly electricity').waitFor();
  await shot(page, '12-dashboard');

  // 10. CarbonTwin
  await page.goto(BASE + '/twin');
  await page.getByLabel('Diesel price per litre (optional)').fill('350');
  await page.getByRole('button', { name: 'Run scenario' }).click();
  await page.getByText('Change').first().waitFor();
  await page.getByRole('button', { name: 'Create improvement action' }).click();
  await page.getByText('Improvement action created').waitFor();
  await shot(page, '13-carbontwin');

  // 11. Compliance: readiness, draft report, reviewer approval, buyer share
  await page.goto(BASE + '/compliance');
  await page.getByRole('button', { name: 'Run readiness check' }).click();
  await page.getByText('All required evidence categories present').waitFor();
  await page.getByRole('button', { name: 'Generate draft evidence report' }).click();
  await page.getByText('v1').first().waitFor();
  await shot(page, '14-compliance-owner');
  await reviewer.goto(BASE + '/compliance');
  await reviewer.getByRole('combobox', { name: 'Reporting period' }).click();
  await reviewer.getByRole('option', { name: /2026-03/ }).click();
  await reviewer.getByLabel('Reviewer comment').fill('Evidence traced to source bills. Energy scope only.');
  await reviewer.getByRole('button', { name: 'Approve for sharing' }).click();
  await reviewer.getByText('Report approved').waitFor();
  await shot(reviewer, '15-reviewer-approved');
  await page.reload();
  await page.getByLabel('Buyer name').fill('Klaus Metallhandel GmbH');
  await page.getByLabel('Email').fill('klaus@buyer.test');
  await page.getByRole('button', { name: 'Create secure link' }).click();
  const shareLink = (await page.locator('code.break').innerText()).trim();
  await shot(page, '16-share');

  // 12. Buyer portal (no account)
  const buyer = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await buyer.goto(shareLink);
  await buyer.getByText('Lanka Aluminium Works').first().waitFor();
  await shot(buyer, '17-buyer-portal');

  // 13. Audit and subscription
  await page.goto(BASE + '/audit');
  await page.getByText('REPORT_APPROVED').waitFor();
  await shot(page, '18-audit');
  await page.goto(BASE + '/subscription');
  await page.getByText('Documents processed').waitFor();
  await shot(page, '19-subscription');

  console.log('\nERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(async (e) => {
  console.error('FAILED:', e.message.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
