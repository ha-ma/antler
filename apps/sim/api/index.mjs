// Vercel の関数の入口（docs/specs/deploy-a/functional.md R1・R3）。api の bundle を再輸出するだけ。
// bundle は build:vercel が作る（apps/api/vite.vercel.config.ts → apps/api/dist/vercel/handler.mjs。コミットしない）。
export { default } from '../../api/dist/vercel/handler.mjs'
