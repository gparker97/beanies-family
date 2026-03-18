# beanies.family

A local-first family finance and life planner. Track your money, your kids' activities, and everything in between — all without giving up your data.

To learn more about what beanies is and why it exists, visit [beanies.family/home](https://beanies.family/home).

## Run it locally

You'll need [Node.js](https://nodejs.org/) v20+ and npm.

```bash
git clone https://github.com/gregcmartin/beanies-family.git
cd beanies-family
npm install
npm run dev
```

That's it. Open `http://localhost:5173` in your browser and you're good to go.

Your data stays on your machine in the browser's IndexedDB. Nothing phones home, nothing gets sent anywhere.

## Build for production

```bash
npm run build
npm run preview
```

## Run tests

```bash
npm run test:run        # unit tests (Vitest)
npm run test:e2e        # end-to-end tests (Playwright)
```

For E2E tests, you may need to install Playwright browsers first: `npx playwright install`.

## Cloud version

If you don't want to deal with running it yourself, create a family account at [beanies.family](https://beanies.family). Your data is fully encrypted and stays in your personal storage — we don't have a database with your stuff in it.

## License

beanies.family is open source. See [LICENSE](./LICENSE) and [TRADEMARK.md](./TRADEMARK.md) for the details.

<img width="192" height="192" alt="beanies.family" src="https://github.com/user-attachments/assets/c6b6fd45-cc71-4feb-9c7d-3fb41c42a4a3" />

*Every bean counts.*
