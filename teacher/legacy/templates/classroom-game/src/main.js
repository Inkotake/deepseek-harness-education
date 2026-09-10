import '@teacher-dsh/artifact-sdk/style.css';
import { createPanel, createTeacherToolbar } from '@teacher-dsh/artifact-sdk';

const questions = [
  { q: '7 × 8 = ?', a: '56' },
  { q: '12 × 12 = ?', a: '144' },
  { q: '9 × 9 = ?', a: '81' }
];
let index = 0;
let score = 0;

const app = document.querySelector('#app');
app.innerHTML = `
  <div style="display:grid;place-items:center;min-height:100vh;background:#0f172a;color:#f8fafc;text-align:center;">
    <div>
      <div id="q" style="font-size:44px;font-weight:700;margin-bottom:20px;">${questions[0].q}</div>
      <input id="answer" type="text" inputmode="numeric" placeholder="输入答案"
        style="font-size:24px;padding:10px;border-radius:8px;border:none;text-align:center;width:220px;" />
      <div style="margin-top:16px;">
        <button id="submit" style="font-size:22px;padding:12px 28px;border-radius:8px;border:none;background:#2563eb;color:#fff;cursor:pointer;">提交</button>
      </div>
      <div id="feedback" style="margin-top:14px;font-size:20px;"></div>
      <div id="score" style="margin-top:8px;font-size:18px;color:#94a3b8;">得分：0</div>
    </div>
  </div>`;

const qEl = document.querySelector('#q');
const answerEl = document.querySelector('#answer');
const submit = document.querySelector('#submit');
const feedback = document.querySelector('#feedback');
const scoreEl = document.querySelector('#score');

function refresh() {
  qEl.textContent = questions[index].q;
  feedback.textContent = '';
  answerEl.value = '';
}

submit.addEventListener('click', () => {
  if (answerEl.value.trim() === questions[index].a) {
    score += 10;
    feedback.textContent = '正确！ +10';
    feedback.style.color = '#4ade80';
  } else {
    feedback.textContent = `正确答案：${questions[index].a}`;
    feedback.style.color = '#f87171';
  }
  scoreEl.textContent = `得分：${score}`;
  index = (index + 1) % questions.length;
  setTimeout(refresh, 900);
});

answerEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit.click();
});

createTeacherToolbar({
  container: document.body,
  onReset: () => { index = 0; score = 0; scoreEl.textContent = '得分：0'; refresh(); }
});