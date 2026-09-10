import '@teacher-dsh/artifact-sdk/style.css';
import * as echarts from 'echarts';
import { createTeacherToolbar } from '@teacher-dsh/artifact-sdk';

const el = document.querySelector('#chart');
el.style.width = '100vw';
el.style.height = '100vh';

const chart = echarts.init(el);
chart.setOption({
  title: { text: '教学数据统计', left: 'center', top: 16 },
  tooltip: {},
  legend: { bottom: 10 },
  xAxis: { type: 'category', data: ['第一组', '第二组', '第三组', '第四组'] },
  yAxis: { type: 'value' },
  series: [
    { name: '平均分', type: 'bar', data: [82, 76, 91, 88], barMaxWidth: 48 },
    { name: '优秀率', type: 'line', data: [0.35, 0.28, 0.55, 0.47] }
  ]
});

window.addEventListener('resize', () => chart.resize());
createTeacherToolbar({
  container: document.body,
  onReset: () => chart.setOption({ series: [{ data: [82, 76, 91, 88] }, { data: [0.35, 0.28, 0.55, 0.47] }] })
});