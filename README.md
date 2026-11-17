# 🐱 냥냥! 국어 길건너기

초등 6학년 2학기 국어 5단원 **언어와 소통**을 학습하는 길건너기 + 체크포인트 퀴즈 게임입니다.
기존 `market-quiz-cat` 프로젝트와 **별도 저장소·별도 순위 데이터**로 운영합니다.

## 기능

- 시장경제 게임의 고양이 SVG를 계승한 5가지 털색
- 차량·기차·강·통나무를 피하는 쿼터뷰 길건너기, PC/모바일 지원
- 매 15칸마다 필수 4지선다 퀴즈 1문제; 답을 맞혀야 다음 구간 진입
- 국어 평가 문제·답지를 토대로 문항과 선택지를 바꿔 만든 **100문항**
- 정답 +100점, 최장 전진 1칸 +10점; 오답 시 3개의 목숨 중 하나 차감
- **명예의 전당 상위 200위, 50명씩 4페이지**, 닉네임당 최고기록 1개만 유지
- 게임 종료 후 오답 복습, 기존 게임의 닉네임 금지어 규칙 일부 계승

## GitHub Pages로 정적 게임 공개

`index.html` 하나만으로 실행됩니다. GitHub Pages에서는 **현재 기기의 브라우저에만** 순위가 저장됩니다. GitHub Pages는 서버/DB가 없는 정적 호스팅이므로 이 단계에서 다른 학생과 공유되는 명예의 전당이라고 안내하면 안 됩니다.

GitHub의 이 저장소에서 **Settings → Pages → Build and deployment → Source: GitHub Actions**를 최초 1회 설정하면 `.github/workflows/pages.yml`이 공개 페이지를 게시합니다.

## 공용 명예의 전당까지 운영하려면

이 저장소의 `worker.mjs`와 `schema.sql`은 별도 **Cloudflare Worker + 신규 D1**용 서버 코드입니다. 이것은 원래 시장경제 게임의 서버나 데이터베이스를 재사용하지 않습니다.

1. Cloudflare 계정에 로그인하고 `wrangler login`을 실행합니다.
2. `wrangler d1 create korean-crossy-cat-db`로 **새 데이터베이스를 생성**합니다.
3. `wrangler.toml.example`을 `wrangler.toml`로 복사하고 새로운 `database_id`를 입력합니다.
4. `wrangler d1 execute korean-crossy-cat-db --remote --file=./schema.sql`로 새 DB 스키마를 생성합니다.
5. `npm test`로 코드를 확인한 뒤 `npm run deploy:cloudflare`를 실행합니다.

Worker에서 제공되는 주소로 접속하면 정답 판정, 닉네임 필터 및 200명 공유 명예의 전당이 서버에서 작동합니다. 이 배포는 Cloudflare 계정 권한·D1 ID 없이는 수행할 수 없습니다.

## 개발

`npm test`: 100문제 구성 및 서버 동작 자동 테스트. `npm run build`: Worker 번들 생성. `index.html`: 스타일·퀴즈·게임 로직을 포함한 단일 HTML 실행 파일. `worker.mjs`: 공개 순위 서버 코드. `schema.sql`: 서버 DB 초기화.
