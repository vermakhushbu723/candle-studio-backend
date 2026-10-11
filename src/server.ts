import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';

async function main() {
  await connectDB();
  createApp().listen(env.port, () => console.log(`Jyotessa API running on http://localhost:${env.port}/api`));
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
