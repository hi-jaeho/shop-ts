import express from 'express';

// Express 객체 생성
const app = express();

// 라우트 설정
app.get('/', (req, res) => {
  // 클라이언트에게 응답 보내기
  res.send('<h2>Hello, World!</h2>');
});

// 서버 실행
const PORT = 8000;
app.listen(PORT, () => {
  console.log(`서버 실행중... http://localhost:${PORT}`);
});